// Local bot load test (Phase 11): N co-op rooms × 5 bots on an in-process server with in-memory
// services (no Supabase/Redis/Railway). The server runs in a CHILD process so bot CPU does not
// skew its numbers; it reports per-room tick time (simulation + state mirror), event-loop delay,
// CPU and memory. Bots walk, sprint, jump, swing and chat like players.
// Usage (from apps/game-server): node --import tsx scripts/loadtest.ts [rooms=50] [seconds=60]
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const PORT = 2570;
const ROLES = ['medic', 'builder', 'scout', 'cook', 'radio'] as const;
const BOTS_PER_ROOM = 5;
const TICK_BUDGET_MS = 10;

if (process.env.LOADTEST_ROLE === 'server') await runServer();
else await runBots();

// ── Server (child) ──────────────────────────────────────────────────────────
async function runServer() {
  const { buildServer } = await import('../src/app.ts');
  const { setPolicy } = await import('../src/policy.ts');
  const { setServices } = await import('../src/services/index.ts');
  const { SurvivalRoom } = await import('../src/rooms/SurvivalRoom.ts');
  const { fakeServices } = await import('../test/helpers.ts');

  const svc = fakeServices();
  // Every bot identity is an eligible player.
  svc.checkEligibility = async (userId: string) => ({
    ok: true,
    profile: {
      userId,
      username: `bot_${userId.slice(0, 6)}`,
      avatar: {},
      chatRestricted: false,
      chatMode: 'full' as const,
    },
  });
  setServices(svc);
  setPolicy({ allowedOrigins: [], requireOrigin: false });

  // Time every room tick (sim.tick + flush/state sync) without touching room code.
  const ticks: number[] = [];
  const proto = SurvivalRoom.prototype as unknown as {
    setSimulationInterval(cb: (dt: number) => void, ms?: number): void;
  };
  const original = proto.setSimulationInterval;
  proto.setSimulationInterval = function (cb, ms) {
    return original.call(
      this,
      (dt: number) => {
        const t0 = performance.now();
        cb(dt);
        ticks.push(performance.now() - t0);
      },
      ms,
    );
  };

  const loop = monitorEventLoopDelay({ resolution: 10 });
  const server = buildServer('loadtest-admin-secret-0123456789abcdef');
  await server.listen(PORT, '127.0.0.1');
  process.send!({ type: 'ready' });

  let cpu0 = process.cpuUsage();
  let t0 = performance.now();
  process.on('message', (m: { type: string }) => {
    if (m.type === 'reset') {
      ticks.length = 0;
      loop.reset();
      loop.enable();
      cpu0 = process.cpuUsage();
      t0 = performance.now();
    }
    if (m.type === 'stats') {
      const cpu = process.cpuUsage(cpu0);
      const wall = performance.now() - t0;
      const s = [...ticks].sort((a, b) => a - b);
      const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
      process.send!({
        type: 'stats',
        ticks: s.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: s[s.length - 1] ?? 0,
        overBudget: s.filter((x) => x > TICK_BUDGET_MS).length,
        loopP99: loop.percentile(99) / 1e6,
        loopMax: loop.max / 1e6,
        cpuPct: ((cpu.user + cpu.system) / 1000 / wall) * 100,
        rssMb: process.memoryUsage().rss / 1048576,
      });
    }
  });
}

// ── Bots (parent) ───────────────────────────────────────────────────────────
async function runBots() {
  const rooms = Number(process.argv[2] ?? 50);
  const seconds = Number(process.argv[3] ?? 60);
  const { ColyseusSDK } = await import('@colyseus/sdk');
  const { SURVIVAL_PROTOCOL_VERSION, BARANGAY_1, groundAt } = await import('@baha/shared/survival');

  const child: ChildProcess = fork(fileURLToPath(import.meta.url), [], {
    env: { ...process.env, LOADTEST_ROLE: 'server', LOG_LEVEL: 'warn' },
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const fromChild = (type: string) =>
    new Promise<any>((r) => {
      const on = (m: { type: string }) => {
        if (m.type === type) {
          child.off('message', on);
          r(m);
        }
      };
      child.on('message', on);
    });
  await fromChild('ready');

  const sdk = (userId: string) => {
    const c = new ColyseusSDK(`http://127.0.0.1:${PORT}`);
    c.auth.token = `tok:${userId}`;
    return c;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn: () => boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!fn()) {
      if (Date.now() > end) throw new Error('timeout');
      await wait(25);
    }
  };

  type Bot = { id: string; room: any; dir: number; seq: number };
  const bots: Bot[] = [];
  let failedRooms = 0;
  let corrections = 0;
  const reasons: Record<string, number> = {};
  let chats = 0;
  const started = Date.now();

  async function startRoom(i: number) {
    const ids = Array.from({ length: BOTS_PER_ROOM }, () => randomUUID());
    const host = await sdk(ids[0]!).create('survival', {
      protocol: SURVIVAL_PROTOCOL_VERSION,
      mode: 'coop',
      difficulty: 'normal',
    });
    const members = [host];
    for (const id of ids.slice(1))
      members.push(await sdk(id).joinById(host.roomId, { protocol: SURVIVAL_PROTOCOL_VERSION }));
    await until(() => (host.state as any)?.players?.size === BOTS_PER_ROOM);
    members.forEach((r, k) => {
      // A corrected bot hit a wall, deep water or the map edge: turn around like a player.
      r.onMessage('correction', (c: { reason: string }) => {
        corrections++;
        reasons[c.reason] = (reasons[c.reason] ?? 0) + 1;
        const b = bots.find((x) => x.room === r);
        if (b) b.dir += Math.PI * (0.5 + Math.random());
      });
      r.onMessage('*', () => {});
      r.onMessage('chat:history', () => {});
      r.send('lobby:setRole', { role: ROLES[k] });
      r.send('lobby:ready', { ready: true });
    });
    await until(() =>
      [...((host.state as any).players.values() as Iterable<{ ready: boolean }>)].every(
        (p) => p.ready,
      ),
    );
    host.send('lobby:start', {});
    await until(() => (host.state as any).phase === 'cutscene');
    for (const r of members) r.send('cutscene:done', {});
    await until(() => (host.state as any).phase === 'playing');
    members.forEach((r, k) => bots.push({ id: ids[k]!, room: r, dir: (i + k) % 6, seq: 0 }));
  }

  // Ramp up in small batches (like real players arriving), then measure.
  for (let i = 0; i < rooms; i += 5) {
    const batch = Array.from({ length: Math.min(5, rooms - i) }, (_, k) =>
      startRoom(i + k).catch((e) => {
        failedRooms++;
        console.error(`room ${i + k} failed: ${e instanceof Error ? e.message : e}`);
      }),
    );
    await Promise.all(batch);
  }
  console.log(
    `${rooms - failedRooms}/${rooms} rooms playing with ${bots.length} bots (ramp ${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );

  // Player-like input: 10 Hz moves (walk/sprint), swings, jumps, chat.
  let t = 0;
  const inputs = setInterval(() => {
    t += 100;
    for (const b of bots) {
      const me = b.room.state?.players?.get(b.id);
      if (!me) continue;
      if (Math.random() < 0.02) b.dir += (Math.random() - 0.5) * 2;
      const sprint = (t / 1000 + b.dir) % 10 < 3;
      // Conservative speeds: wading/swimming is slower than land walking.
      const step = (sprint ? 2.2 : 1.2) * 0.1;
      const x = me.x + Math.cos(b.dir) * step;
      const z = me.z + Math.sin(b.dir) * step;
      // Follow the terrain (or float at the surface) like the real client.
      const water = (b.room.state as { waterLevel?: number }).waterLevel ?? 0;
      b.room.send('move', {
        x,
        y: Math.max(groundAt(BARANGAY_1, x, z), water - 0.9),
        z,
        vx: Math.cos(b.dir) * step * 10,
        vz: Math.sin(b.dir) * step * 10,
        rotY: b.dir,
        anim: sprint ? 'run' : 'walk',
        sprinting: sprint,
        grounded: true,
        t,
      });
      if (Math.random() < 0.05) b.room.send('action:attack', { dir: b.dir, clientSeq: ++b.seq });
      if (Math.random() < 0.01) b.room.send('action:jump', { t });
      if (Math.random() < 0.002) {
        chats++;
        b.room.send('chat:send', {
          text: 'tara sa bubong, may tubig dito',
          clientMsgId: `m${b.seq++}`,
        });
      }
    }
  }, 100);

  await wait(3000);
  child.send({ type: 'reset' });
  await wait(seconds * 1000);
  child.send({ type: 'stats' });
  const s = await fromChild('stats');
  clearInterval(inputs);

  const f = (n: number) => n.toFixed(2);
  console.log(`corrections by reason: ${JSON.stringify(reasons)}`);
  console.log(
    `measured ${seconds} s · ${s.ticks} room ticks · ${chats} chats · ${corrections} corrections`,
  );
  console.log(
    `room tick ms: p50 ${f(s.p50)} · p95 ${f(s.p95)} · p99 ${f(s.p99)} · max ${f(s.max)} · over ${TICK_BUDGET_MS} ms: ${s.overBudget}`,
  );
  console.log(
    `event loop delay ms: p99 ${f(s.loopP99)} · max ${f(s.loopMax)} · server CPU ${s.cpuPct.toFixed(0)}% · RSS ${s.rssMb.toFixed(0)} MB`,
  );
  const ok = failedRooms === 0 && s.p99 < TICK_BUDGET_MS;
  console.log(ok ? 'PASS: p99 room tick under 10 ms' : 'FAIL');

  await Promise.allSettled(bots.map((b) => b.room.leave(true)));
  child.kill();
  process.exit(ok ? 0 : 1);
}
