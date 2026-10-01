import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/app.ts';
import { originAllowed, setPolicy } from '../src/policy.ts';
import { AuthCode, RoomCode } from '../src/rooms/errors.ts';
import type { SurvivalRoom } from '../src/rooms/SurvivalRoom.ts';
import { normalizeCode } from '../src/services/codes.ts';
import { memoryLimiter } from '../src/services/memory.ts';
import { setServices } from '../src/services/index.ts';
import {
  ADMIN_SECRET,
  PORT,
  U,
  createOpts,
  fakeServices,
  joinOpts,
  sdkFor,
  until,
  wait,
  type FakeServices,
} from './helpers.ts';

let colyseus: ColyseusTestServer;
let svc: FakeServices;

beforeAll(async () => {
  svc = fakeServices();
  setServices(svc);
  setPolicy({ allowedOrigins: ['https://baha-ready-3d.vercel.app'], requireOrigin: false });
  colyseus = await boot(buildServer(ADMIN_SECRET), PORT);
});
afterAll(async () => {
  await colyseus.shutdown();
});
afterEach(async () => {
  svc.setDisabled(false);
  svc.limiter = memoryLimiter();
  await colyseus.cleanup();
});

async function errCode(p: Promise<unknown>): Promise<number | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: number }).code;
  }
}

async function hostLobby(mode: 'solo' | 'coop' = 'coop') {
  const host = await sdkFor(U.host).create('survival', createOpts(mode));
  const room = colyseus.getRoomById<SurvivalRoom>(host.roomId) as unknown as SurvivalRoom;
  await until(() => room.state.players.size === 1);
  return { host, room };
}

describe('auth and eligibility (onAuth runs before a room exists)', () => {
  it('rejects a missing or bad token', async () => {
    expect(await errCode(sdkFor(null).create('survival', createOpts()))).toBeDefined();
    const bad = sdkFor(null);
    bad.auth.token = 'garbage';
    expect(await errCode(bad.create('survival', createOpts()))).toBe(AuthCode.UNAUTHORIZED);
  });

  it('rejects facilitators/staff and restricted players', async () => {
    expect(await errCode(sdkFor(U.facilitator).create('survival', createOpts()))).toBe(
      AuthCode.NOT_ELIGIBLE,
    );
    expect(await errCode(sdkFor(U.restricted).create('survival', createOpts()))).toBe(
      AuthCode.NOT_ELIGIBLE,
    );
  });

  it('honours the kill switch', async () => {
    svc.setDisabled(true);
    expect(await errCode(sdkFor(U.host).create('survival', createOpts()))).toBe(
      AuthCode.SURVIVAL_DISABLED,
    );
  });

  it('rejects outdated clients and bad options', async () => {
    expect(await errCode(sdkFor(U.host).create('survival', { ...createOpts(), protocol: 0 }))).toBe(
      AuthCode.OUTDATED_CLIENT,
    );
    expect(
      await errCode(
        sdkFor(U.host).create('survival', { protocol: 1, mode: 'pvp', difficulty: 'normal' }),
      ),
    ).toBeDefined();
  });

  it('does not expose joinOrCreate or public listing', async () => {
    expect(await errCode(sdkFor(U.host).joinOrCreate('survival', createOpts()))).toBeDefined();
    expect(await errCode(sdkFor(U.host).join('survival', joinOpts))).toBeDefined();
  });

  it('rate-limits room creation per user', async () => {
    const codes: (number | undefined)[] = [];
    for (let i = 0; i < 7; i++) {
      const r = sdkFor(U.p3).create('survival', createOpts('solo'));
      codes.push(await errCode(r.then((room) => room.leave(true))));
    }
    expect(codes.slice(0, 6).every((c) => c === undefined)).toBe(true);
    expect(codes[6]).toBe(AuthCode.RATE_LIMITED);
  });

  it('origin allowlist', () => {
    expect(originAllowed('https://baha-ready-3d.vercel.app/')).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed(undefined)).toBe(true); // requireOrigin=false in tests
  });
});

describe('lobby flow', () => {
  it('creates a private coop lobby with a readable code and host', async () => {
    const { room } = await hostLobby();
    expect(room.state.phase).toBe('lobby');
    expect(normalizeCode(room.state.code.toLowerCase())).toBe(room.state.code);
    expect(room.state.hostId).toBe(U.host);
    expect(room.state.maxPlayers).toBe(5);
    const me = room.state.players.get(U.host)!;
    expect(me.isHost).toBe(true);
    expect(JSON.parse(me.avatar)).toEqual({ hat: 'cap_red' }); // unknown/oversized keys dropped
    expect(await svc.codes.resolve(room.state.code)).toBe(room.roomId);
  });

  it('joins by room id, picks unique roles, readies and starts', async () => {
    const { host, room } = await hostLobby();
    const p2 = await sdkFor(U.p2).joinById(room.roomId, joinOpts);
    await until(() => room.state.players.size === 2);
    expect(room.state.players.get(U.p2)!.isHost).toBe(false);

    host.send('lobby:setRole', { role: 'medic' });
    await until(() => room.state.players.get(U.host)!.role === 'medic');
    const err = p2.waitForMessage('lobby:error');
    p2.send('lobby:setRole', { role: 'medic' });
    expect((await err).reason).toBe('role_taken');
    p2.send('lobby:setRole', { role: 'builder' });
    await until(() => room.state.players.get(U.p2)!.role === 'builder');

    // Non-host cannot start; host cannot start until everyone is ready.
    p2.send('lobby:start', {});
    const notReady = host.waitForMessage('lobby:error');
    host.send('lobby:start', {});
    expect((await notReady).reason).toBe('not_all_ready');

    host.send('lobby:ready', { ready: true });
    p2.send('lobby:ready', { ready: true });
    await until(() => [...room.state.players.values()].every((p) => p.ready));

    const starting = p2.waitForMessage('run:starting');
    host.send('lobby:start', {});
    await starting;
    await until(() => room.state.phase === 'cutscene');
    expect(room.locked).toBe(true);
    expect(await svc.codes.resolve(room.state.code)).toBeNull(); // code freed at start

    // Late joiners are refused.
    expect(await errCode(sdkFor(U.p3).joinById(room.roomId, joinOpts))).toBeDefined();

    host.send('cutscene:done', {});
    p2.send('cutscene:done', {});
    await until(() => room.state.phase === 'playing');
  });

  it('coop needs the minimum team size', async () => {
    const { host } = await hostLobby();
    host.send('lobby:setRole', { role: 'scout' });
    host.send('lobby:ready', { ready: true });
    const e = host.waitForMessage('lobby:error');
    host.send('lobby:start', {});
    expect((await e).reason).toBe('not_enough_players');
  });

  it('solo runs start alone with the solo role and are capped at 1', async () => {
    const { host, room } = await hostLobby('solo');
    expect(room.state.players.get(U.host)!.role).toBe('solo');
    expect(await errCode(sdkFor(U.p2).joinById(room.roomId, joinOpts))).toBeDefined();
    host.send('lobby:ready', { ready: true });
    host.send('lobby:start', {});
    await until(() => room.state.phase === 'cutscene');
  });

  it('only the host changes difficulty, which resets ready', async () => {
    const { host, room } = await hostLobby();
    const p2 = await sdkFor(U.p2).joinById(room.roomId, joinOpts);
    p2.send('lobby:setRole', { role: 'cook' });
    p2.send('lobby:ready', { ready: true });
    await until(() => room.state.players.get(U.p2)?.ready === true);
    p2.send('lobby:setDifficulty', { difficulty: 'hard' });
    await wait(80);
    expect(room.state.difficulty).toBe('normal');
    host.send('lobby:setDifficulty', { difficulty: 'hard' });
    await until(() => room.state.difficulty === 'hard');
    expect(room.state.players.get(U.p2)!.ready).toBe(false);
  });

  it('host can kick; kicked players cannot rejoin', async () => {
    const { host, room } = await hostLobby();
    const p2 = await sdkFor(U.p2).joinById(room.roomId, joinOpts);
    await until(() => room.state.players.size === 2);
    const left = new Promise<number>((r) => p2.onLeave((code) => r(code)));
    host.send('lobby:kick', { userId: U.p2 });
    expect(await left).toBe(RoomCode.KICKED);
    await until(() => room.state.players.size === 1);
    expect(await errCode(sdkFor(U.p2).joinById(room.roomId, joinOpts))).toBe(RoomCode.KICKED);
  });

  it('transfers host when the host leaves', async () => {
    const { host, room } = await hostLobby();
    await sdkFor(U.p2).joinById(room.roomId, joinOpts);
    await until(() => room.state.players.size === 2);
    await host.leave(true);
    await until(() => room.state.hostId === U.p2);
    expect(room.state.players.get(U.p2)!.isHost).toBe(true);
    expect(room.state.players.has(U.host)).toBe(false);
  });

  it('keeps the seat across a dropped connection (SDK auto-reconnect)', async () => {
    const { room } = await hostLobby();
    const p2 = await sdkFor(U.p2).joinById(room.roomId, joinOpts);
    p2.reconnection.minUptime = 0;
    p2.reconnection.minDelay = 50;
    p2.reconnection.delay = 50;
    p2.send('lobby:setRole', { role: 'radio' });
    await until(() => room.state.players.get(U.p2)?.role === 'radio');
    // Simulate a network drop: the server sees an abnormal close, not a consented leave.
    p2.connection.close(4010); // CloseCode.MAY_TRY_RECONNECT, like a network blip
    await until(() => room.state.players.get(U.p2)?.connected === false);
    await until(() => room.state.players.get(U.p2)?.connected === true, 5000);
    expect(room.state.players.get(U.p2)!.role).toBe('radio');
    expect(room.state.players.size).toBe(2);
  });

  it('rejects a second session for the same user', async () => {
    const { room } = await hostLobby();
    expect(await errCode(sdkFor(U.host).joinById(room.roomId, joinOpts))).toBe(
      RoomCode.DUPLICATE_SESSION,
    );
  });

  it('drops invalid payloads silently', async () => {
    const { host, room } = await hostLobby();
    host.send('lobby:setRole', { role: 'wizard' });
    host.send('lobby:ready', { ready: 'yes' });
    host.send('nonsense', { a: 1 });
    await wait(80);
    expect(room.state.players.get(U.host)!.role).toBe('');
    expect(room.state.players.get(U.host)!.ready).toBe(false);
  });

  it('releases the code when the room is disposed', async () => {
    const { host, room } = await hostLobby();
    const code = room.state.code;
    await host.leave(true);
    await until(() => room.state.players.size === 0);
    await wait(100);
    expect(await svc.codes.resolve(code)).toBeNull();
  });
});

describe('http', () => {
  it('health is public; admin needs the secret', async () => {
    const h = await colyseus.http.get(`/health`);
    expect((h.data as { ok: boolean }).ok).toBe(true);
    const denied = await colyseus.http.get(`/admin/rooms`).catch((e: { statusCode: number }) => e);
    expect(denied.statusCode).toBe(401);
    const wrong = await colyseus.http
      .get(`/admin/rooms`, { headers: { authorization: 'Bearer nope' } })
      .catch((e: { statusCode: number }) => e);
    expect(wrong.statusCode).toBe(401);
  });

  it('admin lists and force-closes rooms', async () => {
    const { host, room } = await hostLobby();
    const auth = { headers: { authorization: `Bearer ${ADMIN_SECRET}` } };
    const list = await colyseus.http.get(`/admin/rooms`, auth);
    const rooms = (list.data as { rooms: { roomId: string; phase: string }[] }).rooms;
    expect(rooms.find((r) => r.roomId === room.roomId)?.phase).toBe('lobby');
    const left = new Promise<number>((r) => host.onLeave((code) => r(code)));
    await colyseus.http.post(`/admin/rooms/${room.roomId}/close`, auth);
    expect(await left).toBe(RoomCode.FORCE_CLOSED);
  });
});
