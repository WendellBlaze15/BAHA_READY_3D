import { CloseCode, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { z } from 'zod';
import {
  DIFFICULTIES,
  SURVIVAL_PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type ClientMessageType,
  type SurvivalConfig,
} from '@baha/shared/survival';
import { errInfo, log } from '../log.ts';
import { originAllowed } from '../policy.ts';
import { services, type PlayerProfile } from '../services/index.ts';
import { AuthCode, RoomCode } from './errors.ts';
import { LobbyPlayer, SurvivalState } from './state.ts';

export const ROOM_NAME = 'survival';

/** How long a lobby code stays reserved without a refresh. */
const CODE_TTL_SEC = 15 * 60;
const ELIGIBILITY_RECHECK_MS = 5 * 60_000;
/** Lobby drops get a short grace; in-game reconnection uses config.session.reconnectSec. */
const LOBBY_RECONNECT_SEC = 30;

const createOptions = z.object({
  protocol: z.number().int(),
  mode: z.enum(['solo', 'coop']),
  difficulty: z.enum(DIFFICULTIES),
});
const joinOptions = z.object({ protocol: z.number().int() }).loose();

export interface AuthData {
  profile: PlayerProfile;
  exp: number;
}
type SurvivalClient = Client<{ auth: AuthData }>;

export interface RoomMeta {
  code: string;
  mode: 'solo' | 'coop';
  difficulty: string;
  phase: string;
  players: number;
  maxPlayers: number;
  hostUsername: string;
  createdAt: number;
}

export type Phase = 'lobby' | 'cutscene' | 'playing' | 'ended';

/**
 * One Survival session (Section 20). Phase 4 = lobby: create/join by code, roles, ready,
 * difficulty, kick, start, host transfer, reconnection, idle close. The simulation lands in
 * Phase 5 on top of this room.
 */
export class SurvivalRoom extends Room<{
  state: SurvivalState;
  metadata: RoomMeta;
  client: SurvivalClient;
}> {
  state = new SurvivalState();
  maxMessagesPerSecond = 40;
  autoDispose = true;

  private config!: SurvivalConfig;
  private configId = '';
  private kicked = new Set<string>();
  private cutsceneDone = new Set<string>();
  private lastActivity = Date.now();
  private codeReleased = false;
  private createdAt = Date.now();

  /** Runs at matchmaking time, BEFORE a room is created or a seat is reserved. */
  static async onAuth(token: string, options: unknown, context: AuthContext): Promise<AuthData> {
    if (!originAllowed(context.headers.get('origin')))
      throw new ServerError(AuthCode.BAD_ORIGIN, 'origin_not_allowed');
    const opts = joinOptions.safeParse(options);
    if (!opts.success) throw new ServerError(AuthCode.BAD_OPTIONS, 'bad_options');
    if (opts.data.protocol !== SURVIVAL_PROTOCOL_VERSION)
      throw new ServerError(AuthCode.OUTDATED_CLIENT, 'outdated_client');
    if (!token) throw new ServerError(AuthCode.UNAUTHORIZED, 'unauthorized');

    const s = services();
    const id = await s.verifyToken(token);
    if (!id) throw new ServerError(AuthCode.UNAUTHORIZED, 'unauthorized');
    const creating = 'mode' in (options as object);
    if (!(await s.limiter.check(creating ? 'room_create' : 'room_join', id.userId)))
      throw new ServerError(AuthCode.RATE_LIMITED, 'rate_limited');
    const el = await s.checkEligibility(id.userId);
    if (!el.ok)
      throw new ServerError(
        el.reason === 'survival_disabled' ? AuthCode.SURVIVAL_DISABLED : AuthCode.NOT_ELIGIBLE,
        el.reason,
      );
    return { profile: el.profile, exp: id.exp };
  }

  async onCreate(options: unknown) {
    const opts = createOptions.safeParse(options);
    if (!opts.success) throw new ServerError(AuthCode.BAD_OPTIONS, 'bad_options');
    const { config, id, version } = await services().currentConfig();
    this.config = config;
    this.configId = id;

    const solo = opts.data.mode === 'solo';
    this.maxClients = solo ? 1 : config.session.maxPlayers;
    const st = this.state;
    st.phase = 'lobby';
    st.mode = opts.data.mode;
    st.difficulty = opts.data.difficulty;
    st.maxPlayers = this.maxClients;
    st.minPlayers = solo ? 1 : config.session.minCoopPlayers;
    st.configVersion = version;
    st.protocol = SURVIVAL_PROTOCOL_VERSION;

    const code = await services().codes.reserve(this.roomId, CODE_TTL_SEC);
    if (!code) throw new ServerError(AuthCode.UNAVAILABLE, 'no_code_available');
    st.code = code;
    // Never listed publicly — joining is by code (or the host's invite link) only.
    await this.setPrivate(true);
    await this.syncMetadata();

    this.registerMessages();
    this.clock.setInterval(() => void this.housekeeping(), 30_000);
    this.clock.setInterval(() => void this.recheckEligibility(), ELIGIBILITY_RECHECK_MS);
    log.info('room created', { roomId: this.roomId, mode: st.mode, difficulty: st.difficulty });
  }

  onJoin(client: SurvivalClient) {
    const auth = client.auth!;
    const { userId } = auth.profile;
    if (this.kicked.has(userId)) throw new ServerError(RoomCode.KICKED, 'kicked');
    if (this.state.phase !== 'lobby')
      throw new ServerError(RoomCode.ALREADY_STARTED, 'already_started');
    if (this.state.players.has(userId))
      throw new ServerError(RoomCode.DUPLICATE_SESSION, 'duplicate_session');

    client.userData = undefined;
    const p = new LobbyPlayer();
    p.userId = userId;
    p.username = auth.profile.username;
    p.role = this.state.mode === 'solo' ? 'solo' : '';
    p.ready = false;
    p.connected = true;
    p.joinedAt = Date.now();
    p.avatar = JSON.stringify(pickAvatar(auth.profile.avatar));
    p.isHost = this.state.players.size === 0;
    if (p.isHost) this.state.hostId = userId;
    this.state.players.set(userId, p);
    this.touch();
    void this.syncMetadata();
    log.info('player joined', { roomId: this.roomId, userId });
  }

  async onDrop(client: SurvivalClient) {
    const p = this.playerOf(client);
    if (!p) return;
    p.connected = false;
    p.ready = false;
    const seconds =
      this.state.phase === 'lobby' ? LOBBY_RECONNECT_SEC : this.config.session.reconnectSec;
    try {
      await this.allowReconnection(client, seconds);
    } catch {
      /* not back in time → onLeave */
    }
  }

  onReconnect(client: SurvivalClient) {
    const p = this.playerOf(client);
    if (p) p.connected = true;
    this.touch();
  }

  onLeave(client: SurvivalClient, code?: number) {
    const userId = client.auth?.profile.userId;
    if (!userId || !this.state.players.has(userId)) return;
    // During a run the player stays in the roster (Phase 7 keeps their run membership).
    if (this.state.phase === 'lobby') this.state.players.delete(userId);
    else this.state.players.get(userId)!.connected = false;
    if (this.state.hostId === userId) this.transferHost();
    void this.syncMetadata();
    log.info('player left', { roomId: this.roomId, userId, code });
  }

  async onDispose() {
    await this.releaseCode();
    log.info('room disposed', { roomId: this.roomId });
  }

  onBeforeShutdown() {
    // Phase 7 saves a snapshot here before closing.
    void this.disconnect(RoomCode.SERVER_SHUTDOWN);
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  private registerMessages() {
    const on = <T extends ClientMessageType>(
      type: T,
      fn: (c: SurvivalClient, m: ClientMessage<T>) => void,
    ) =>
      this.onMessage(type, (client: SurvivalClient, raw: unknown) => {
        const msg = parseClientMessage(type, raw);
        if (!msg) return; // invalid payloads are dropped silently
        fn(client, msg.data as ClientMessage<T>);
      });

    on('lobby:setRole', (c, m) => {
      const p = this.lobbyPlayer(c);
      if (!p || this.state.mode === 'solo') return;
      const taken = [...this.state.players.values()].some(
        (o) => o.userId !== p.userId && o.role === m.role,
      );
      if (taken) return this.reject(c, 'role_taken');
      p.role = m.role;
      p.ready = false;
      this.touch();
    });

    on('lobby:ready', (c, m) => {
      const p = this.lobbyPlayer(c);
      if (!p) return;
      if (m.ready && !p.role) return this.reject(c, 'pick_role_first');
      p.ready = m.ready;
      this.touch();
    });

    on('lobby:setDifficulty', (c, m) => {
      if (!this.isHost(c) || this.state.phase !== 'lobby') return;
      if (this.state.difficulty === m.difficulty) return;
      this.state.difficulty = m.difficulty;
      // Everyone re-confirms after a difficulty change.
      for (const p of this.state.players.values()) p.ready = false;
      this.touch();
      void this.syncMetadata();
    });

    on('lobby:kick', (c, m) => {
      if (!this.isHost(c) || this.state.phase !== 'lobby') return;
      if (m.userId === this.state.hostId) return;
      const target = this.clients.find((x) => x.auth?.profile.userId === m.userId);
      this.kicked.add(m.userId);
      this.state.players.delete(m.userId);
      target?.leave(RoomCode.KICKED);
      void this.syncMetadata();
      this.touch();
    });

    on('lobby:start', (c) => {
      if (!this.isHost(c) || this.state.phase !== 'lobby') return;
      const why = this.cannotStart();
      if (why) return this.reject(c, why);
      void this.startRun();
    });

    on('cutscene:done', (c) => {
      if (this.state.phase !== 'cutscene') return;
      const uid = c.auth?.profile.userId;
      if (uid) this.cutsceneDone.add(uid);
      const connected = [...this.state.players.values()].filter((p) => p.connected);
      if (connected.every((p) => this.cutsceneDone.has(p.userId))) this.beginPlay();
    });

    // Anything else (unknown or not-yet-implemented types) is ignored.
    this.onMessage('*', () => {});
  }

  /** Null when the lobby can start; otherwise a reason key the client translates. */
  cannotStart(): string | null {
    const players = [...this.state.players.values()];
    if (players.length < this.state.minPlayers) return 'not_enough_players';
    if (players.some((p) => !p.connected)) return 'player_disconnected';
    if (players.some((p) => !p.role)) return 'roles_missing';
    if (players.some((p) => !p.ready)) return 'not_all_ready';
    return null;
  }

  private async startRun() {
    this.state.phase = 'cutscene';
    await this.lock();
    await this.releaseCode();
    await this.syncMetadata();
    this.broadcast('run:starting', { configVersion: this.state.configVersion });
    log.info('run starting', {
      roomId: this.roomId,
      players: this.state.players.size,
      configId: this.configId,
    });
    // Synced cutscene: everyone skips/finishes, or the timer moves the team on.
    this.clock.setTimeout(() => this.beginPlay(), this.config.session.cutsceneMaxWaitSec * 1000);
  }

  private beginPlay() {
    if (this.state.phase !== 'cutscene') return;
    this.state.phase = 'playing';
    void this.syncMetadata();
    // Phase 5: the simulation loop starts here.
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private playerOf(c: SurvivalClient) {
    const uid = c.auth?.profile.userId;
    return uid ? this.state.players.get(uid) : undefined;
  }

  private lobbyPlayer(c: SurvivalClient) {
    return this.state.phase === 'lobby' ? this.playerOf(c) : undefined;
  }

  private isHost(c: SurvivalClient) {
    return !!c.auth && c.auth.profile.userId === this.state.hostId;
  }

  private reject(c: SurvivalClient, reason: string) {
    c.send('lobby:error', { reason });
  }

  private transferHost() {
    const next = [...this.state.players.values()]
      .filter((p) => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    for (const p of this.state.players.values()) p.isHost = p === next;
    this.state.hostId = next?.userId ?? '';
    if (next) this.broadcast('lobby:hostChanged', { userId: next.userId });
  }

  private touch() {
    this.lastActivity = Date.now();
  }

  private async housekeeping() {
    if (this.state.phase !== 'lobby') return;
    const idleMs = this.config.session.lobbyIdleMin * 60_000;
    if (Date.now() - this.lastActivity > idleMs) {
      log.info('lobby idle, closing', { roomId: this.roomId });
      await this.disconnect(RoomCode.LOBBY_IDLE);
      return;
    }
    if (!this.codeReleased) {
      try {
        await services().codes.refresh(this.state.code, CODE_TTL_SEC);
      } catch (e) {
        log.warn('code refresh failed', { roomId: this.roomId, ...errInfo(e) });
      }
    }
  }

  /** Suspensions, restrictions and the kill switch take effect mid-session. */
  private async recheckEligibility() {
    for (const c of this.clients) {
      const uid = c.auth?.profile.userId;
      if (!uid) continue;
      try {
        const el = await services().checkEligibility(uid);
        if (!el.ok) c.leave(RoomCode.ELIGIBILITY_LOST);
      } catch (e) {
        log.warn('eligibility recheck failed', { roomId: this.roomId, ...errInfo(e) });
      }
    }
  }

  private async releaseCode() {
    if (this.codeReleased || !this.state.code) return;
    this.codeReleased = true;
    try {
      await services().codes.release(this.state.code);
    } catch (e) {
      log.warn('code release failed', { roomId: this.roomId, ...errInfo(e) });
    }
  }

  private async syncMetadata() {
    const host = this.state.players.get(this.state.hostId);
    await this.setMetadata({
      code: this.codeReleased ? '' : this.state.code,
      mode: this.state.mode as 'solo' | 'coop',
      difficulty: this.state.difficulty,
      phase: this.state.phase,
      players: this.state.players.size,
      maxPlayers: this.state.maxPlayers,
      hostUsername: host?.username ?? '',
      createdAt: this.createdAt,
    });
  }
}

/** Only known cosmetic keys are mirrored into synced state (no free text). */
function pickAvatar(a: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const k of [
    'skin',
    'hair',
    'hairColor',
    'shirt',
    'pants',
    'shoes',
    'hat',
    'accessory',
    'preset',
  ]) {
    const v = a[k];
    if (typeof v === 'string' && /^[a-z0-9_#-]{1,32}$/i.test(v)) out[k] = v;
  }
  return out;
}

export { CloseCode };
