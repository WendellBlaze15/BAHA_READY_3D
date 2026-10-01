import { randomInt } from 'node:crypto';
import { CloseCode, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { z } from 'zod';
import {
  DIFFICULTIES,
  SURVIVAL_PROTOCOL_VERSION,
  inBounds,
  parseClientMessage,
  type ClientMessage,
  type ClientMessageType,
  type Difficulty,
  type SurvivalConfig,
} from '@baha/shared/survival';
import { errInfo, log } from '../log.ts';
import { originAllowed } from '../policy.ts';
import { services, type PlayerProfile } from '../services/index.ts';
import { Simulation } from '../sim/simulation.ts';
import { ChatHandler } from './chat-handler.ts';
import { AuthCode, RoomCode } from './errors.ts';
import { CampState, PlayerState, SurvivalState } from './state.ts';
import { syncWorld } from './sync.ts';

export const ROOM_NAME = 'survival';

/** How long a lobby code stays reserved without a refresh. */
const CODE_TTL_SEC = 15 * 60;
const ELIGIBILITY_RECHECK_MS = 5 * 60_000;
/** Lobby drops get a short grace; in-game reconnection uses config.session.reconnectSec. */
const LOBBY_RECONNECT_SEC = 30;
/** 20 Hz simulation and patches (Section 18.4). */
const TICK_MS = 50;
const LEARNING_FLUSH_MS = 10_000;
const EMOTE_INTERVAL_SEC = 2;
const PING_RANGE_M = 80;
const PING_TTL_MS = 10_000;

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

/** Messages handled by the simulation once the run is playing. */
type SimMessage = Exclude<
  ClientMessageType,
  | 'lobby:setRole'
  | 'lobby:ready'
  | 'lobby:setDifficulty'
  | 'lobby:kick'
  | 'lobby:start'
  | 'cutscene:done'
  | 'chat:send'
  | 'chat:mute'
  | 'chat:unmute'
  | 'chat:report'
  | 'quickChat'
>;

/**
 * One Survival session (Sections 16–20): lobby (codes, roles, ready, kick, start, host
 * transfer), the synced cutscene, then the authoritative 20 Hz simulation. All client input is
 * schema-validated and applied with the verified JWT user id — never a client-supplied id.
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
  private runId: string | null = null;
  private sessionId: string | null = null;
  private runReady: Promise<void> | null = null;
  private sim: Simulation | null = null;
  private chat!: ChatHandler;

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
    st.camp = new CampState();

    const code = await services().codes.reserve(this.roomId, CODE_TTL_SEC);
    if (!code) throw new ServerError(AuthCode.UNAVAILABLE, 'no_code_available');
    st.code = code;
    // Never listed publicly — joining is by code (or the host's invite link) only.
    await this.setPrivate(true);
    await this.syncMetadata();

    this.chat = new ChatHandler(config.chat, {
      runId: () => this.runId,
      sessionId: () => this.sessionId,
      members: () =>
        this.clients
          .filter((c) => c.auth)
          .map((c) => ({
            profile: c.auth!.profile,
            send: (t: string, p: unknown) => c.send(t, p),
          })),
      sendTo: (uid, t, p) => this.clientOf(uid)?.send(t, p),
    });
    this.registerMessages();
    this.clock.setInterval(() => void this.housekeeping(), 30_000);
    this.clock.setInterval(() => void this.recheckEligibility(), ELIGIBILITY_RECHECK_MS);
    this.clock.setInterval(() => void this.flushLearning(), LEARNING_FLUSH_MS);
    log.info('room created', { roomId: this.roomId, mode: st.mode, difficulty: st.difficulty });
  }

  async onJoin(client: SurvivalClient) {
    const auth = client.auth!;
    const { userId } = auth.profile;
    if (this.kicked.has(userId)) throw new ServerError(RoomCode.KICKED, 'kicked');
    if (this.state.phase !== 'lobby')
      throw new ServerError(RoomCode.ALREADY_STARTED, 'already_started');
    if (this.state.players.has(userId))
      throw new ServerError(RoomCode.DUPLICATE_SESSION, 'duplicate_session');

    const p = new PlayerState();
    p.userId = userId;
    p.username = auth.profile.username;
    p.role = this.state.mode === 'solo' ? 'solo' : '';
    p.ready = false;
    p.connected = true;
    p.joinedAt = Date.now();
    p.avatar = JSON.stringify(pickAvatar(auth.profile.avatar));
    p.life = 'alive';
    p.isHost = this.state.players.size === 0;
    if (p.isHost) this.state.hostId = userId;
    this.state.players.set(userId, p);
    this.attachView(client);
    this.touch();
    void this.syncMetadata();
    log.info('player joined', { roomId: this.roomId, userId });

    // The run row is created when the host arrives (chat is stored against it from the lobby on).
    if (p.isHost && !this.runReady) this.runReady = this.createRun(userId);
    await this.chat.loadRelations([...this.state.players.keys()]);
    client.send('chat:history', { lines: this.chat.historyFor(auth.profile) });
  }

  async onDrop(client: SurvivalClient) {
    const p = this.playerOf(client);
    if (!p) return;
    p.connected = false;
    p.ready = false;
    this.sim?.setConnected(p.userId, false);
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
    if (p) this.sim?.setConnected(p.userId, true);
    this.attachView(client);
    this.touch();
  }

  onLeave(client: SurvivalClient, code?: number) {
    const userId = client.auth?.profile.userId;
    if (!userId || !this.state.players.has(userId)) return;
    // During a run the player stays in the roster as "disconnected" (Section 16.5).
    if (this.state.phase === 'lobby') this.state.players.delete(userId);
    else {
      this.state.players.get(userId)!.connected = false;
      this.sim?.setConnected(userId, false);
    }
    if (this.state.hostId === userId) this.transferHost();
    void this.syncMetadata();
    log.info('player left', { roomId: this.roomId, userId, code });
  }

  async onDispose() {
    await this.releaseCode();
    await this.flushLearning();
    try {
      await this.runReady;
      const s = services().db;
      if (this.runId && this.state.phase === 'lobby') await s.setRunStatus(this.runId, 'abandoned');
      if (this.sessionId)
        await s.endSession(
          this.sessionId,
          this.state.phase === 'lobby' ? 'lobby_closed' : 'room_closed',
        );
    } catch (e) {
      log.warn('dispose persistence failed', { roomId: this.roomId, ...errInfo(e) });
    }
    if (this.sim?.flags.size)
      log.warn('run flags', { roomId: this.roomId, runId: this.runId, flags: [...this.sim.flags] });
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
      fn: (c: SurvivalClient, m: ClientMessage<T>) => void | Promise<void>,
    ) =>
      this.onMessage(type, (client: SurvivalClient, raw: unknown) => {
        const msg = parseClientMessage(type, raw);
        if (!msg || !client.auth) return; // invalid payloads are dropped silently
        const r = fn(client, msg.data as ClientMessage<T>);
        if (r instanceof Promise)
          r.catch((e) => log.warn('handler failed', { type, ...errInfo(e) }));
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
      const target = this.clientOf(m.userId);
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
      return this.startRun();
    });

    on('cutscene:done', (c) => {
      if (this.state.phase !== 'cutscene') return;
      this.cutsceneDone.add(c.auth!.profile.userId);
      const connected = [...this.state.players.values()].filter((p) => p.connected);
      if (connected.every((p) => this.cutsceneDone.has(p.userId))) this.beginPlay();
    });

    // ── Communication (lobby and in-run) ──
    on('chat:send', (c, m) => {
      this.touch();
      return this.chat.send(c.auth!.profile, m);
    });
    on('chat:mute', (c, m) => this.chat.mute(c.auth!.profile, m.userId, true));
    on('chat:unmute', (c, m) => this.chat.mute(c.auth!.profile, m.userId, false));
    on('chat:report', (c, m) => this.chat.report(c.auth!.profile, m));
    on('quickChat', (c, m) => this.chat.quick(c.auth!.profile, m));

    // ── Simulation intents (playing only) ──
    const play = <T extends SimMessage>(
      type: T,
      fn: (sim: Simulation, uid: string, m: ClientMessage<T>) => void,
    ) =>
      on(type, (c, m) => {
        if (this.state.phase !== 'playing' || !this.sim) return;
        fn(this.sim, c.auth!.profile.userId, m);
        this.flush();
      });

    play('move', (s, uid, m) => s.move(uid, m));
    play('action:jump', (s, uid) => s.jump(uid));
    play('action:attack', (s, uid, m) => s.attack(uid, m));
    play('interact', (s, uid, m) => s.interact(uid, m.targetId));
    play('useItem', (s, uid, m) => s.useItem(uid, m.slot, m.targetUserId));
    play('bag:move', (s, uid, m) => s.bagMove(uid, m.from, m.to));
    play('bag:drop', (s, uid, m) => s.bagDrop(uid, m.slot, m.qty));
    play('bag:split', (s, uid, m) => s.bagSplit(uid, m.slot, m.qty));
    play('bag:equip', (s, uid, m) => s.equip(uid, m.slot));
    play('give:offer', (s, uid, m) => s.offerGive(uid, m.toUserId, m.slot));
    play('give:accept', (s, uid, m) => s.acceptGive(uid, m.offerId));
    play('storage:deposit', (s, uid, m) => s.deposit(uid, m.itemKey, m.qty));
    play('storage:withdraw', (s, uid, m) => s.withdraw(uid, m.itemKey, m.qty));
    play('craft', (s, uid, m) => s.craft(uid, m.recipeKey));
    play('pause', (s, uid, m) => s.setPaused(uid, m.paused));
    play('ping', (s, uid, m) => {
      const p = s.players.get(uid);
      if (!p || p.life === 'dead') return;
      if (!inBounds(s.map, m.x, m.z) || Math.hypot(m.x - p.x, m.z - p.z) > PING_RANGE_M) return;
      if (!s.throttle(uid, 'ping', this.config.chat.pingIntervalMs / 1000)) return;
      this.broadcast('ping', {
        userId: uid,
        type: m.type,
        x: m.x,
        y: m.y,
        z: m.z,
        until: Date.now() + PING_TTL_MS,
      });
    });
    play('emote', (s, uid, m) => {
      const p = s.players.get(uid);
      if (!p || p.life !== 'alive' || !s.throttle(uid, 'emote', EMOTE_INTERVAL_SEC)) return;
      p.anim = 'emote';
      this.broadcast('emote', { userId: uid, id: m.id });
    });
    // Phase 6: build, revive, vote.

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

  private async createRun(hostId: string) {
    const db = services().db;
    try {
      this.runId = await db.createRun({
        hostId,
        mode: this.state.mode as 'solo' | 'coop',
        difficulty: this.state.difficulty,
        configVersionId: this.configId,
        seed: randomInt(1, 2 ** 31 - 1),
      });
      this.sessionId = await db.createSession(this.runId, this.roomId);
    } catch (e) {
      log.error('run create failed', { roomId: this.roomId, ...errInfo(e) });
    }
  }

  private async startRun() {
    this.state.phase = 'cutscene';
    await this.lock();
    await this.releaseCode();
    await this.syncMetadata();
    await this.runReady;
    const players = [...this.state.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    this.sim = new Simulation({
      config: this.config,
      difficulty: this.state.difficulty as Difficulty,
      seed: randomInt(1, 2 ** 31 - 1),
      solo: this.state.mode === 'solo',
      players: players.map((p) => ({ userId: p.userId, username: p.username, role: p.role })),
    });
    syncWorld(this.state, this.sim, true);
    if (this.runId) {
      try {
        const db = services().db;
        await db.setMembers(
          this.runId,
          players.map((p) => ({ userId: p.userId, role: p.role })),
        );
        await db.setRunStatus(this.runId, 'active');
      } catch (e) {
        log.error('run start persistence failed', { roomId: this.roomId, ...errInfo(e) });
      }
    }
    this.broadcast('run:starting', { configVersion: this.state.configVersion });
    log.info('run starting', {
      roomId: this.roomId,
      runId: this.runId,
      players: players.length,
      configId: this.configId,
    });
    // Synced cutscene: everyone skips/finishes, or the timer moves the team on.
    this.clock.setTimeout(() => this.beginPlay(), this.config.session.cutsceneMaxWaitSec * 1000);
  }

  private beginPlay() {
    if (this.state.phase !== 'cutscene' || !this.sim) return;
    this.state.phase = 'playing';
    void this.syncMetadata();
    this.setSimulationInterval((dtMs) => {
      if (!this.sim) return;
      // Clamp: a stalled event loop must not fast-forward stats in one giant step.
      this.sim.tick(Math.min(dtMs, 250) / 1000);
      this.flush();
    }, TICK_MS);
  }

  /** Delivers queued simulation messages and mirrors state. */
  private flush() {
    const sim = this.sim;
    if (!sim) return;
    for (const o of sim.drainOut()) {
      if (o.to === 'all') this.broadcast(o.type, o.payload);
      else this.clientOf(o.to)?.send(o.type, o.payload);
    }
    syncWorld(this.state, sim);
  }

  private async flushLearning() {
    if (!this.sim || !this.runId || !this.sim.learning.length) return;
    const batch = this.sim.learning.splice(0, this.sim.learning.length);
    try {
      await services().db.insertLearning(batch.map((l) => ({ ...l, runId: this.runId! })));
    } catch (e) {
      log.warn('learning flush failed', { roomId: this.roomId, ...errInfo(e) });
      this.sim.learning.unshift(...batch.slice(-500));
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Own full bag is visible only through this client's StateView. */
  private attachView(client: SurvivalClient) {
    const p = this.playerOf(client);
    if (!p) return;
    client.view = new StateView();
    client.view.add(p);
    // Slots pushed later must flow to this view too.
    client.view.subscribe(p.bag);
  }

  private clientOf(userId: string) {
    return this.clients.find((x) => x.auth?.profile.userId === userId);
  }

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

  /** Suspensions, restrictions, chat restrictions and the kill switch apply mid-session. */
  private async recheckEligibility() {
    for (const c of this.clients) {
      const uid = c.auth?.profile.userId;
      if (!uid) continue;
      try {
        const el = await services().checkEligibility(uid);
        if (!el.ok) c.leave(RoomCode.ELIGIBILITY_LOST);
        else c.auth!.profile = el.profile;
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

  /** Test hook: the live simulation (null before the run starts). */
  get simulation() {
    return this.sim;
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
