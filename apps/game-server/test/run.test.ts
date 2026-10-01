import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/app.ts';
import { setPolicy } from '../src/policy.ts';
import type { SurvivalRoom } from '../src/rooms/SurvivalRoom.ts';
import { setServices } from '../src/services/index.ts';
import { memoryLimiter, memoryModeration } from '../src/services/memory.ts';
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
  setPolicy({ allowedOrigins: [], requireOrigin: false });
  colyseus = await boot(buildServer(ADMIN_SECRET), PORT);
});
afterAll(async () => {
  await colyseus.shutdown();
});
afterEach(async () => {
  svc.limiter = memoryLimiter();
  svc.moderation = memoryModeration();
  svc.store.chatOn = true;
  svc.store.mutes.clear();
  await colyseus.cleanup();
});

type AnyRoom = SdkRoom<any, any>;

/** Messages of one type collected on a client. */
function collect(room: AnyRoom, type: string) {
  const got: any[] = [];
  room.onMessage(type, (m: unknown) => got.push(m));
  return got;
}

async function coopLobby() {
  const host = await sdkFor(U.host).create('survival', createOpts('coop', 'normal'));
  const room = colyseus.getRoomById(host.roomId) as unknown as SurvivalRoom;
  const p2 = await sdkFor(U.p2).joinById(host.roomId, joinOpts);
  await until(() => room.state.players.size === 2);
  return { host, p2, room };
}

async function startCoop() {
  const l = await coopLobby();
  l.host.send('lobby:setRole', { role: 'medic' });
  l.p2.send('lobby:setRole', { role: 'scout' });
  l.host.send('lobby:ready', { ready: true });
  l.p2.send('lobby:ready', { ready: true });
  await until(() => [...l.room.state.players.values()].every((p) => p.ready));
  l.host.send('lobby:start', {});
  await until(() => l.room.state.phase === 'cutscene');
  l.host.send('cutscene:done', {});
  l.p2.send('cutscene:done', {});
  await until(() => l.room.state.phase === 'playing');
  return l;
}

describe('run lifecycle and synced world', () => {
  it('creates the run when the host arrives and activates it at start', async () => {
    const { room } = await startCoop();
    const runs = [...svc.store.runs.values()];
    const run = runs[runs.length - 1]!;
    expect(run.status).toBe('active');
    expect(run.members.map((m) => m.role).sort()).toEqual(['medic', 'scout']);
    expect(room.simulation).not.toBeNull();
    expect(room.state.day).toBe(1);
    expect(room.state.players.get(U.host)!.health).toBe(100);
  });

  it('abandons a run that never left the lobby', async () => {
    const host = await sdkFor(U.host).create('survival', createOpts());
    await wait(100);
    await host.leave(true);
    await until(() => [...svc.store.runs.values()].some((r) => r.status === 'abandoned'));
  });

  it('own bag is private (StateView); teammates only see weight', async () => {
    const { host, room } = await startCoop();
    const sim = room.simulation!;
    sim.players.get(U.host)!.bag[0] = { item: 'rope', qty: 2 };
    sim.players.get(U.p2)!.bag[0] = { item: 'tarp', qty: 1 };
    sim.dirty.bags.add(U.host).add(U.p2);
    await wait(200);
    const st = host.state as any;
    expect(st.players.get(U.host).bag[0].item).toBe('rope');
    const theirs = st.players.get(U.p2).bag;
    expect(!theirs || theirs.length === 0).toBe(true);
    expect(st.players.get(U.p2).weight).toBeGreaterThan(0);
  });

  it('corrects impossible movement over the wire', async () => {
    const { host, room } = await startCoop();
    const corr = collect(host, 'correction');
    const me = room.state.players.get(U.host)!;
    host.send('move', {
      x: me.x + 40,
      y: me.y,
      z: me.z,
      vx: 0,
      vz: 0,
      rotY: 0,
      anim: 'run',
      sprinting: false,
      grounded: true,
      t: 100,
    });
    await until(() => corr.length > 0);
    expect(corr[0].x).toBeCloseTo(me.x);
  });

  it('vote-kick removes a player from this session only', async () => {
    const { host, p2, room } = await startCoop();
    const left = new Promise<number>((r) => p2.onLeave((c) => r(c)));
    host.send('vote', { type: 'kick', targetUserId: U.p2, value: true });
    expect(await left).toBe(4101);
    await wait(100);
    expect(room.state.players.get(U.p2)?.connected).toBe(false);
    expect(room.simulation!.players.get(U.p2)!.life).toBe('disconnected');
    expect(room.state.voteType).toBe('');
  });

  it('drops malformed intents', async () => {
    const { host, room } = await startCoop();
    const me = room.state.players.get(U.host)!;
    const x = me.x;
    host.send('move', { x: 'far', z: 1 });
    host.send('craft', { recipeKey: '../../etc' });
    await wait(150);
    expect(me.x).toBe(x);
  });
});

describe('team chat (Section 17)', () => {
  it('delivers clean text, masks profanity, rejects contact info — all stored', async () => {
    const { host, p2 } = await coopLobby();
    const got = collect(p2, 'chat:message');
    const rejected = collect(host, 'chat:rejected');
    host.send('chat:send', { text: 'Tara sa palengke', clientMsgId: 'm1' });
    await until(() => got.length === 1);
    expect(got[0].text).toBe('Tara sa palengke');
    await wait(1600);
    host.send('chat:send', { text: 'bobo ka talaga', clientMsgId: 'm2' });
    await until(() => got.length === 2);
    expect(got[1].text).toContain('*');
    expect(got[1].status).toBe('masked');
    await wait(1600);
    host.send('chat:send', { text: 'add mo ko sa fb', clientMsgId: 'm3' });
    await until(() => rejected.length === 1);
    expect(rejected[0]).toMatchObject({ clientMsgId: 'm3', reasonKey: 'personal_info' });
    await wait(100);
    expect(got.length).toBe(2);
    expect(svc.store.chat.map((c) => c.status)).toEqual(['delivered', 'masked', 'rejected']);
  });

  it('rate limits and blocks duplicate spam', async () => {
    const { host } = await coopLobby();
    const rejected = collect(host, 'chat:rejected');
    host.send('chat:send', { text: 'hello', clientMsgId: 'a' });
    host.send('chat:send', { text: 'hello again', clientMsgId: 'b' });
    await until(() => rejected.length === 1);
    expect(rejected[0].reasonKey).toBe('rate_limited');
  });

  it('auto-mutes after repeated rejected messages', async () => {
    const { host } = await coopLobby();
    const muted = collect(host, 'chat:muted');
    for (const [i, t] of ['09171234567', 'email ko a@b.co', 'www.site.com'].entries()) {
      host.send('chat:send', { text: t, clientMsgId: `x${i}` });
      await wait(1600);
    }
    await until(() => muted.length === 1);
    expect(muted[0].until).toBeGreaterThan(Date.now() + 9 * 60_000);
    // While muted nothing is accepted.
    host.send('chat:send', { text: 'ok na', clientMsgId: 'y' });
    await until(() => muted.length === 2);
  });

  it('respects admin chat restrictions; quick chat still works', async () => {
    const host = await sdkFor(U.host).create('survival', createOpts());
    const room = colyseus.getRoomById(host.roomId) as unknown as SurvivalRoom;
    const p3 = await sdkFor(U.p3).joinById(host.roomId, joinOpts); // p3 is chat-restricted
    await until(() => room.state.players.size === 2);
    const rejected = collect(p3, 'chat:rejected');
    const quick = collect(host, 'quickChat');
    p3.send('chat:send', { text: 'hi', clientMsgId: 'r' });
    p3.send('quickChat', { id: 0 });
    await until(() => rejected.length === 1 && quick.length === 1);
    expect(rejected[0].reasonKey).toBe('restricted');
    expect(quick[0]).toMatchObject({ senderId: U.p3, id: 0 });
  });

  it('honours the chat kill switch', async () => {
    const { host } = await coopLobby();
    svc.store.chatOn = false;
    const rejected = collect(host, 'chat:rejected');
    host.send('chat:send', { text: 'hello', clientMsgId: 'k' });
    await until(() => rejected.length === 1);
    expect(rejected[0].reasonKey).toBe('chat_disabled');
  });

  it('muting a teammate hides their messages (persisted)', async () => {
    const { host, p2 } = await coopLobby();
    const got = collect(p2, 'chat:message');
    const state = collect(p2, 'chat:muteState');
    p2.send('chat:mute', { userId: U.host });
    await until(() => state.length === 1);
    expect(svc.store.mutes.has(`${U.p2}>${U.host}`)).toBe(true);
    host.send('chat:send', { text: 'nandito ako', clientMsgId: 'h' });
    await wait(250);
    expect(got.length).toBe(0);
  });

  it('reports attach context; personal-info reports are high priority', async () => {
    const { host, p2 } = await coopLobby();
    const got = collect(p2, 'chat:message');
    const ack = collect(p2, 'chat:reported');
    host.send('chat:send', { text: 'kita tayo mamaya', clientMsgId: 'q' });
    await until(() => got.length === 1);
    p2.send('chat:report', { messageId: got[0].id, reason: 'personal_info_request' });
    await until(() => ack.length === 1);
    expect(ack[0].ok).toBe(true);
    const rep = svc.store.reports[svc.store.reports.length - 1]!;
    expect(rep).toMatchObject({
      reportedId: U.host,
      reporterId: U.p2,
      priority: 'high',
      messageId: got[0].id,
    });
    expect((rep.evidence.message_ids as number[]).includes(got[0].id)).toBe(true);
  });

  it('sends recent history to players who join later', async () => {
    const host = await sdkFor(U.host).create('survival', createOpts());
    const room = colyseus.getRoomById(host.roomId) as unknown as SurvivalRoom;
    await until(() => room.state.players.size === 1);
    host.send('chat:send', { text: 'welcome', clientMsgId: 'w' });
    await until(() => svc.store.chat.length > 0);
    const p2sdk = sdkFor(U.p2);
    const p2 = await p2sdk.joinById(host.roomId, joinOpts);
    const hist = await p2.waitForMessage('chat:history');
    expect(hist.lines.map((l: { text: string }) => l.text)).toContain('welcome');
  });
});
