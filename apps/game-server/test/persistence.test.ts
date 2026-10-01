import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SURVIVAL_CONFIG, countItem, survivalConfigSchema } from '@baha/shared/survival';
import { buildServer } from '../src/app.ts';
import { setPolicy } from '../src/policy.ts';
import { leaveRunOffline } from '../src/rooms/persistence.ts';
import type { SurvivalRoom } from '../src/rooms/SurvivalRoom.ts';
import { setServices } from '../src/services/index.ts';
import { memoryLimiter } from '../src/services/memory.ts';
import { Simulation } from '../src/sim/simulation.ts';
import { applySnapshot, toSnapshot } from '../src/sim/snapshot.ts';
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

const config = survivalConfigSchema.parse(DEFAULT_SURVIVAL_CONFIG);

describe('snapshot round-trip (pure)', () => {
  it('restores world, bags, storage, boat, clock and the RNG sequence exactly', () => {
    const mk = () =>
      new Simulation({
        config,
        difficulty: 'normal',
        seed: 99,
        solo: false,
        players: [
          { userId: U.host, username: 'a', role: 'medic' },
          { userId: U.p2, username: 'b', role: 'scout' },
        ],
      });
    const a = mk();
    for (let i = 0; i < 200; i++) a.tick(0.05);
    a.obj.grant(a.players.get(U.host)!, 'rope', 3);
    a.storage.set('nails', 12);
    a.obj.boat.stage = 2;
    a.obj.boat.progress = 0.4;
    a.lootOpened.add('camp_roof_b_l0');
    a.learn(U.host, 'wore_boots', true);
    a.rng.next();

    const snap = JSON.parse(JSON.stringify(toSnapshot(a)));
    const b = mk();
    applySnapshot(b, snap);
    expect(b.clock).toEqual(a.clock);
    expect(countItem(b.players.get(U.host)!.bag, 'rope')).toBe(3);
    expect(b.storage.get('nails')).toBe(12);
    expect(b.obj.boat).toMatchObject({ stage: 2, progress: 0.4 });
    expect(b.lootOpened.has('camp_roof_b_l0')).toBe(true);
    expect(b.learningLog).toHaveLength(a.learningLog.length);
    expect(b.rng.next()).toBe(a.rng.next());
    // Nobody is in the world until they join the new session.
    expect([...b.players.values()].every((p) => p.life === 'disconnected')).toBe(true);
  });
});

let colyseus: ColyseusTestServer;
let svc: FakeServices;
const auth = { authorization: `Bearer ${ADMIN_SECRET}` };

beforeAll(async () => {
  svc = fakeServices();
  setServices(svc);
  setPolicy({ allowedOrigins: [], requireOrigin: false });
  colyseus = await boot(buildServer(ADMIN_SECRET), PORT);
});
afterAll(async () => {
  await colyseus.shutdown();
});
afterEach(async () => {
  svc.limiter = memoryLimiter();
  svc.store.runs.clear();
  await colyseus.cleanup();
});

async function startCoop() {
  const host = await sdkFor(U.host).create('survival', createOpts('coop', 'normal'));
  const room = colyseus.getRoomById(host.roomId) as unknown as SurvivalRoom;
  const p2 = await sdkFor(U.p2).joinById(host.roomId, joinOpts);
  await until(() => room.state.players.size === 2);
  host.send('lobby:setRole', { role: 'medic' });
  p2.send('lobby:setRole', { role: 'scout' });
  host.send('lobby:ready', { ready: true });
  p2.send('lobby:ready', { ready: true });
  await until(() => [...room.state.players.values()].every((p) => p.ready));
  host.send('lobby:start', {});
  await until(() => room.state.phase === 'cutscene');
  host.send('cutscene:done', {});
  p2.send('cutscene:done', {});
  await until(() => room.state.phase === 'playing');
  const runId = [...svc.store.runs.keys()].at(-1)!;
  return { host, p2, room, runId };
}

const resume = (runId: string, userId: string) =>
  colyseus.http
    .post(`/internal/runs/${runId}/resume`, {
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    .then((r: { data: unknown }) => r.data as { roomId: string; created: boolean })
    .catch((e: { statusCode: number; data: unknown }) => ({ error: e.statusCode }));

describe('save → leave → resume (Section 16.6)', () => {
  it('saves on start and on close, resumes from the snapshot, notifies teammates', async () => {
    const { host, p2, room, runId } = await startCoop();
    await until(() => (svc.store.snapshots.get(runId)?.length ?? 0) >= 1);
    room.simulation!.storage.set('rope', 7);
    room.simulation!.clock = { day: 4, minute: 600 };
    await host.leave(true);
    await p2.leave(true);
    await until(() => (svc.store.snapshots.get(runId)?.length ?? 0) >= 2, 4000);

    // A stranger can't resume someone else's run.
    expect(await resume(runId, U.p3)).toEqual({ error: 403 });

    const r = (await resume(runId, U.host)) as { roomId: string; created: boolean };
    expect(r.created).toBe(true);
    // A second click returns the same live room.
    expect(((await resume(runId, U.p2)) as { roomId: string }).roomId).toBe(r.roomId);
    expect(svc.store.notices.at(-1)).toMatchObject({ runId, by: U.host, day: 4 });

    const back = await sdkFor(U.host).joinById(r.roomId, joinOpts);
    const room2 = colyseus.getRoomById(r.roomId) as unknown as SurvivalRoom;
    await until(() => room2.state.players.get(U.host)?.connected === true);
    expect(room2.state.phase).toBe('playing');
    expect(room2.state.day).toBe(4);
    expect(room2.state.storage.get('rope')).toBe(7);
    expect(room2.simulation!.players.get(U.p2)!.life).toBe('disconnected'); // not here yet

    // Teammate rejoins anytime; non-members are refused.
    await sdkFor(U.p2).joinById(r.roomId, joinOpts);
    await until(() => room2.state.players.get(U.p2)?.connected === true);
    await expect(sdkFor(U.p3).joinById(r.roomId, joinOpts)).rejects.toBeDefined();
    await back.leave(true);
  });

  it('caps active runs per player', async () => {
    const host = await sdkFor(U.host).create('survival', createOpts());
    await wait(50);
    // Pretend three active runs already exist for this player.
    for (let i = 0; i < 3; i++) {
      const id = await svc.db.createRun({
        hostId: U.host,
        mode: 'coop',
        difficulty: 'normal',
        configVersionId: 'cfg-1',
        seed: i + 1,
      });
      await svc.db.setMembers(id, [{ userId: U.host, role: 'medic' }]);
      await svc.db.setRunStatus(id, 'active');
    }
    await host.leave(true);
    const err = await sdkFor(U.host)
      .create('survival', createOpts())
      .then(
        () => null,
        (e: { code?: number }) => e.code,
      );
    expect(err).toBe(409);
  });

  it('leaving a paused run moves the bag into camp storage and passes host', async () => {
    const { host, p2, room, runId } = await startCoop();
    room.simulation!.obj.grant(room.simulation!.players.get(U.host)!, 'tarp', 2);
    await host.leave(true);
    await p2.leave(true);
    await until(() => (svc.store.snapshots.get(runId)?.length ?? 0) >= 2, 4000);
    expect(await leaveRunOffline(runId, U.host)).toEqual({ ok: true });
    const snap = svc.store.snapshots.get(runId)!.at(-1) as {
      storage: Record<string, number>;
      players: Record<string, unknown>;
    };
    expect(snap.storage.tarp).toBe(2);
    expect(snap.players[U.host]).toBeUndefined();
    expect((await svc.db.loadRun(runId))!.hostId).toBe(U.p2);
  });
});

describe('ending and rest', () => {
  it('ending persists results through finish_survival_run', async () => {
    const { host, room, runId } = await startCoop();
    const ended = host.waitForMessage('ended');
    room.simulation!.obj.end();
    await ended;
    await until(() => svc.store.finished.has(runId));
    const payload = svc.store.finished.get(runId)!;
    expect(payload).toMatchObject({ ending: 'failed', team_size: 2 });
    expect(Object.keys(payload.players as object).sort()).toEqual([U.host, U.p2].sort());
    expect(room.state.phase).toBe('ended');
  });

  it('a passed "Pahinga" vote saves and ends the session at dawn', async () => {
    const { host, p2, room } = await startCoop();
    const sim = room.simulation!;
    for (const uid of [U.host, U.p2]) sim.placeAt(sim.players.get(uid)!, 0, 4);
    await wait(100);
    const left = new Promise<number>((r) => host.onLeave((c) => r(c)));
    host.send('vote', { type: 'rest', value: true });
    p2.send('vote', { type: 'rest', value: true });
    await until(() => room.state.voteType === '');
    sim.clock = { day: 1, minute: 4 * 60 + 59.5 };
    expect(await left).toBe(4111);
  });
});
