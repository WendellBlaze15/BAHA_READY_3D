'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Group } from 'three';
import { create } from 'zustand';
import {
  BARANGAY_1,
  groundAt,
  survivalConfigSchema,
  type SurvivalConfig,
} from '@baha/shared/survival';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyCharacter, type CharacterAction } from '@/game/entities/BlockyCharacter';
import {
  DEFAULT_CAM_PREFS,
  cameraConfigOf,
  cameraDirection,
  followLerp,
  initialCamState,
  stepCamera,
  type CamPrefs,
} from '@/game/systems/camera';
import {
  consumeAttack,
  consumeInteract,
  consumeJump,
  consumeLook,
  getInput,
  isSprintHeld,
} from '@/game/systems/input';
import { haptic } from '@/game/systems/audio';
import { bus } from './bus';
import { stepController, type CtrlState } from './controller';
import { nearestTarget, type Target } from './interaction';
import { mapValues, useRoomState, useSession, type SyncState } from './session-store';

const SEND_HZ = 15;

/** Current interaction target for the HUD (only updated when it changes). */
export const useTarget = create<{ target: Target | null }>(() => ({ target: null }));

/** Performs the HUD's "Use" action for the current target. */
export function interactWith(t: Target | null) {
  const room = useSession.getState().room;
  if (!room || !t) return;
  switch (t.kind) {
    case 'loot':
      return room.send('interact', { targetId: `loot:${t.id}` });
    case 'drop':
      return room.send('interact', { targetId: `drop:${t.id}` });
    case 'npc':
      return room.send('interact', { targetId: `npc:${t.id}` });
    case 'revive':
      return room.send('revive', { targetUserId: t.userId });
    case 'storage':
      return useSession.getState().set({ panel: 'storage' });
    case 'boat':
      return useSession.getState().set({ panel: 'boat' });
    case 'signal':
      return room.send('build', { target: 'signal', action: 'work' });
    case 'sleep':
      return room.send('interact', { targetId: 'sleep' });
  }
}

export function LocalPlayer({
  config,
  avatar,
  prefs = DEFAULT_CAM_PREFS,
}: {
  config: SurvivalConfig;
  avatar: Partial<AvatarConfig> | null;
  prefs?: CamPrefs;
}) {
  const { camera } = useThree();
  const g = useRef<Group>(null);
  const speed = useRef(0);
  const action = useRef<CharacterAction>({ airborne: false, sprinting: false, swing: 0 });
  const cfg = useMemo(() => survivalConfigSchema.parse(config), [config]);
  const camCfg = useMemo(() => cameraConfigOf(cfg.camera), [cfg]);
  const cam = useRef(initialCamState(false, camCfg, 0));
  const ctrl = useRef<CtrlState | null>(null);
  const lastSend = useRef(0);
  const t0 = useRef(performance.now());
  const seq = useRef(0);
  const lastSwing = useRef(0);
  const targetTick = useRef(0);
  const look = useMemo(() => new Vector3(), []);
  const myId = useSession((x) => x.myId);
  const hand = useRoomState((x) => (myId ? (x.players?.get?.(myId)?.hand as string) : ''), 2);
  const camPos = useMemo(() => new Vector3(), []);

  // Keyboard "E" interacts with the current target.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyE') interactWith(useTarget.getState().target);
      if (e.code === 'KeyF')
        useSession.getState().room?.send('action:attack', {
          dir: ctrl.current?.facing ?? 0,
          clientSeq: ++seq.current,
        });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const ses = useSession.getState();
    const room = ses.room;
    const s = room?.state as SyncState;
    const me = ses.myId ? s?.players?.get?.(ses.myId) : undefined;
    if (!room || !me || !g.current) return;

    if (!ctrl.current)
      ctrl.current = {
        x: me.x,
        y: me.y,
        z: me.z,
        vy: 0,
        facing: me.rotY ?? 0,
        grounded: true,
        climbing: false,
      };
    const c = ctrl.current;

    // Server-placed (respawn, boat ride) or corrected positions win.
    if (bus.correction) {
      c.x = bus.correction.x;
      c.y = bus.correction.y;
      c.z = bus.correction.z;
      c.vy = 0;
      bus.correction = null;
    }
    const busy = ses.chatOpen || (ses.panel !== null && ses.panel !== 'map');
    const life = me.life as string;
    const canMove =
      (life === 'alive' || life === 'downed') &&
      !me.onBoat &&
      !me.rescued &&
      !s.paused &&
      s.phase === 'playing';
    const look_ = consumeLook();
    const raw = busy || !canMove ? { x: 0, y: 0 } : getInput();
    const jump = consumeJump() && !busy;
    const attack = consumeAttack() && !busy;
    if (consumeInteract() && !busy) interactWith(useTarget.getState().target);

    // Camera-relative input → world direction.
    const dir = cameraDirection(cam.current.yaw, cam.current.pitch);
    const fx = -dir.x;
    const fz = -dir.z;
    const fl = Math.hypot(fx, fz) || 1;
    // forward = away from the camera; right = forward rotated 90° (x right, z toward viewer).
    const mx = (fx * raw.y - fz * raw.x) / fl;
    const mz = (fz * raw.y + fx * raw.x) / fl;

    if (me.onBoat || me.rescued || !canMove) {
      // Follow the authoritative position smoothly.
      c.x += (me.x - c.x) * Math.min(1, dt * 8);
      c.y += (me.y - c.y) * Math.min(1, dt * 8);
      c.z += (me.z - c.z) * Math.min(1, dt * 8);
      speed.current = 0;
    } else {
      const weight = me.weight ?? 0;
      const r = stepController(
        c,
        { mx, mz, sprint: isSprintHeld(), jump: jump && !me.hingal && life === 'alive' },
        dt,
        {
          map: BARANGAY_1,
          waterLevel: s.waterLevel ?? BARANGAY_1.baseWaterLevel,
          actions: cfg.actions,
          bag: cfg.bag,
          carryRatio: weight / cfg.bag.maxWeightKg,
          sprintAllowed:
            !me.hingal &&
            (me.stamina ?? 0) >= cfg.actions.sprintMinStartStamina &&
            !String(me.effects ?? '').includes('exhausted'),
          swimSpeedMul: me.role === 'scout' ? cfg.roles.scout.swimSpeedMul : 1,
          crawlMul: life === 'downed' ? cfg.events.downedCrawlSpeedMul : null,
        },
      );
      ctrl.current = r.s;
      speed.current = r.speed;
      action.current.sprinting = r.sprinting;
      action.current.airborne = !r.s.grounded;
      if (r.jumped) room.send('action:jump', { t: Math.round(performance.now() - t0.current) });
    }
    const cc = ctrl.current;
    action.current.tired = !!me.hingal;
    if (attack && life === 'alive') {
      room.send('action:attack', { dir: cc.facing, clientSeq: ++seq.current });
      lastSwing.current = performance.now();
      haptic(20);
    }
    action.current.swing = Math.max(0, 1 - (performance.now() - lastSwing.current) / 400);

    g.current.position.set(cc.x, cc.y, cc.z);
    g.current.rotation.set(0, cc.facing, life === 'downed' ? Math.PI / 2.4 : 0);
    g.current.visible = life !== 'dead';

    // 15 Hz authoritative movement samples.
    const now = performance.now();
    if (canMove && !me.onBoat && now - lastSend.current >= 1000 / SEND_HZ) {
      lastSend.current = now;
      room.send('move', {
        x: Math.round(cc.x * 1000) / 1000,
        y: Math.round(cc.y * 1000) / 1000,
        z: Math.round(cc.z * 1000) / 1000,
        vx: 0,
        vz: 0,
        rotY: cc.facing,
        anim: !cc.grounded
          ? 'jump'
          : speed.current > 0.3
            ? action.current.sprinting
              ? 'run'
              : 'walk'
            : 'idle',
        sprinting: action.current.sprinting,
        grounded: cc.grounded,
        t: Math.round(now - t0.current),
      });
    }

    // Interaction target (5 Hz; HUD only re-renders on change).
    if (now - targetTick.current > 200) {
      targetTick.current = now;
      const players = mapValues<{ life: string; username: string; x: number; z: number }>(
        s.players,
      );
      const t =
        life === 'alive'
          ? nearestTarget({
              map: BARANGAY_1,
              me: { x: cc.x, z: cc.z, userId: ses.myId! },
              lootOpened: new Set(mapValues<boolean>(s.lootOpened).map(([k]) => k)),
              crates: mapValues<{ x: number; z: number }>(s.crates).map(([k, v]) => ({
                id: k,
                x: v.x,
                z: v.z,
              })),
              drops: mapValues<{ item: string; x: number; z: number }>(s.drops).map(([k, v]) => ({
                id: k,
                ...v,
              })),
              npcs: mapValues<{ x: number; z: number; state: string }>(s.npcs).map(([k, v]) => ({
                id: k,
                ...v,
              })),
              downed: players
                .filter(([, p]) => p.life === 'downed')
                .map(([k, p]) => ({ userId: k, name: p.username, x: p.x, z: p.z })),
              shelterBuilt: String(s.camp?.structures ?? '')
                .split(',')
                .includes('shelter'),
              night: s.dayPhase === 'night' || s.dayPhase === 'dusk',
              finalDay: s.day >= cfg.session.totalDays,
            })
          : null;
      const prev = useTarget.getState().target;
      if (JSON.stringify(prev) !== JSON.stringify(t)) useTarget.setState({ target: t });
    }

    // Chase camera (same math as the Signal levels): orbit, zoom, auto-follow.
    cam.current = stepCamera(
      cam.current,
      {
        lookX: look_.dx,
        lookY: look_.dy,
        zoom: look_.zoom,
        moving: speed.current > 0.3,
        forward: Math.max(0, raw.y),
        facing: cc.facing,
      },
      dt,
      camCfg,
      prefs,
    );
    const d = cameraDirection(cam.current.yaw, cam.current.pitch);
    look.set(cc.x, cc.y + 1.4, cc.z);
    camPos.set(
      look.x + d.x * cam.current.distance,
      look.y + d.y * cam.current.distance,
      look.z + d.z * cam.current.distance,
    );
    // Never put the camera inside a building or under the floodwater surface.
    const floor =
      Math.max(groundAt(BARANGAY_1, camPos.x, camPos.z), (s.waterLevel ?? 1) + 0.3) + 0.4;
    if (camPos.y < floor) camPos.y = floor;
    camera.position.lerp(camPos, followLerp(dt, prefs.reducedMotion));
    camera.lookAt(look);
  });

  return (
    <group ref={g}>
      <BlockyCharacter
        config={avatar}
        speedRef={speed}
        actionRef={action}
        tool={hand === 'axe' ? 'axe' : null}
        castShadow
      />
    </group>
  );
}
