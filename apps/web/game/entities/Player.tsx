'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { RapierCollider as Collider } from '@react-three/rapier';
import { Vector3, type Group, type SpotLight } from 'three';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { setSprintIntent, stepSprint, tryJump, withActions } from '@baha/shared/game';
import { BlockyCharacter, type CharacterAction } from './BlockyCharacter';
import { consumeJump, consumeLook, getInput, isSprintHeld } from '../systems/input';
import { depthBand, depthSpeed, live, useGame } from '../store/game-store';
import { audio, haptic } from '../systems/audio';
import {
  cameraConfigOf,
  cameraDirection,
  collisionDistance,
  followLerp,
  initialCamState,
  stepCamera,
} from '../systems/camera';
import { CAMERA_RAY_FLAGS, CAMERA_RAY_GROUPS } from '../systems/camera-groups';

const GROUND_Y = 0.9;
const GRAVITY = 20; // m/s² — snappy, game-feel gravity
const JUMP_VELOCITY = 6.6; // ≈ 1.1 m apex with GRAVITY

export type CameraMode = 'indoor' | 'outdoor';

/**
 * Third-person player: Rapier kinematic character controller (slides along walls), camera-
 * relative movement, click-to-move, current push, depth-based speed. All per-frame state
 * is mutated in refs / `live`, never React state.
 */
export function Player({
  start,
  avatar,
  cameraMode,
  flashlight = false,
  extraForce,
}: {
  start: { x: number; z: number };
  avatar: Partial<AvatarConfig> | null;
  cameraMode: CameraMode;
  flashlight?: boolean;
  /** Extra lateral velocity (m/s), e.g. strong current zones. */
  extraForce?: () => { x: number; z: number };
}) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<Collider>(null);
  const visual = useRef<Group>(null);
  const light = useRef<SpotLight>(null);
  const speedRef = useRef(0);
  const actionRef = useRef<CharacterAction>({
    airborne: false,
    sprinting: false,
    tired: false,
    swing: 0,
  });
  const { world, rapier } = useRapier();
  const { camera } = useThree();
  const camTarget = useMemo(() => new Vector3(), []);
  const camPos = useMemo(() => new Vector3(), []);
  // Chase camera state (refs only — no React renders per frame).
  const indoor = cameraMode === 'indoor';
  const cam = useRef({
    ...initialCamState(indoor, cameraConfigOf(useGame.getState().config?.camera)),
    yaw: indoor ? 0.35 : 0,
  });
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), [rapier]);
  const camDist = useRef(cam.current.distance);
  const followWeight = useRef(0);
  const movedLastFrame = useRef(false);

  // Created/removed inside the effect so StrictMode's mount→unmount→mount never leaves us
  // holding a freed WASM controller.
  const controllerRef = useRef<ReturnType<typeof world.createCharacterController> | null>(null);
  useEffect(() => {
    const c = world.createCharacterController(0.05);
    c.setSlideEnabled(true);
    c.enableAutostep(0.35, 0.2, true);
    c.enableSnapToGround(0.3);
    c.setApplyImpulsesToDynamicBodies(false);
    controllerRef.current = c;
    return () => {
      controllerRef.current = null;
      world.removeCharacterController(c);
    };
  }, [world]);

  useEffect(() => {
    live.player = { x: start.x, z: start.z, y: 0, yaw: 0 };
    live.cameraYaw = cam.current.yaw;
  }, [start.x, start.z, cameraMode]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = useGame.getState();
    const b = body.current;
    const col = collider.current;
    const controller = controllerRef.current;
    if (!b || !col || !controller) return;
    const active = !s.paused && (s.phase === 'prep' || s.phase === 'evac');

    // ── Camera orbit / auto-follow (before movement, so input is camera-relative) ──
    const camCfg = cameraConfigOf(s.config?.camera);
    const look = consumeLook();
    cam.current = stepCamera(
      cam.current,
      {
        lookX: active ? look.dx : 0,
        lookY: active ? look.dy : 0,
        zoom: look.zoom,
        moving: active && movedLastFrame.current,
        forward: followWeight.current,
        facing: live.player.yaw,
      },
      dt,
      camCfg,
      s.camPrefs,
    );
    live.cameraYaw = cam.current.yaw;
    const yaw = cam.current.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: -fwd.z, z: fwd.x };

    let vx = 0;
    let vz = 0;
    followWeight.current = 0;
    if (active) {
      const input = getInput();
      if (input.x !== 0 || input.y !== 0) {
        vx = fwd.x * input.y + right.x * input.x;
        vz = fwd.z * input.y + right.z * input.x;
        // Auto-follow strength: full when pushing forward, none when strafing/backing up.
        followWeight.current = Math.max(0, input.y) / Math.max(1e-6, Math.hypot(input.x, input.y));
        if (s.moveTarget) useGame.getState().setMoveTarget(null);
      } else if (s.moveTarget) {
        const dx = s.moveTarget.x - live.player.x;
        const dz = s.moveTarget.z - live.player.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) useGame.getState().setMoveTarget(null);
        else {
          vx = dx / d;
          vz = dz / d;
          followWeight.current = 1;
        }
      }
    }
    movedLastFrame.current = Math.hypot(vx, vz) > 0.1;

    // ── Sprint (energy-limited) ─────────────────────────────────────
    const actions = withActions(s.config?.actions);
    const band = depthBand(live.depth);
    const deepWater = band === 'waist' || band === 'chest';
    const moving = Math.hypot(vx, vz) > 0.1;
    const want = active && moving && !deepWater && isSprintHeld();
    if (want !== live.sprint.want) {
      live.sprint = setSprintIntent(live.sprint, want);
      if (active) useGame.getState().log({ type: 'sprint', payload: { on: want } });
    }
    if (active) {
      // Single stamina integration point (shared rules). Terrain drains come from
      // systems/logic.tsx; refill waits the regen delay, then walk/idle rate.
      const wasLocked = live.sprint.exhausted;
      const r = stepSprint({ ...live.sprint, stamina: live.stamina }, dt, actions, {
        moving,
        extraDrainPerSec: s.phase === 'evac' ? live.terrainDrain : 0,
      });
      live.sprint = r.state;
      live.stamina = r.state.stamina;
      if (wasLocked && !r.state.exhausted) haptic(15); // sprint available again
    }

    // ── Jump ────────────────────────────────────────────────────────
    const p0 = b.translation();
    const grounded = !live.airborne || p0.y <= GROUND_Y + 1e-3;
    if (consumeJump() && active && grounded && !deepWater) {
      const next = tryJump({ ...live.sprint, stamina: live.stamina }, actions);
      if (next) {
        live.sprint = next;
        live.stamina = next.stamina;
        live.vy = JUMP_VELOCITY;
        live.airborne = true;
        controller.disableSnapToGround();
        useGame.getState().log({ type: 'jump', payload: {} });
        audio.blip('jump');
      }
    }

    // Owner decision: no slow-motion when tired — walking speed never depends on stamina.
    // Only lesson-bearing modifiers (water depth) change it.
    const sprintMul = live.sprint.sprinting ? actions.sprintMultiplier : 1;
    const speed = actions.walkSpeed * depthSpeed(live.depth) * sprintMul;
    let mx = vx * speed * dt;
    let mz = vz * speed * dt;
    if (active && extraForce) {
      const f = extraForce();
      mx += f.x * dt;
      mz += f.z * dt;
    }

    // Vertical: jump arc under gravity; a small constant push keeps us snapped when grounded.
    let dy = -0.02;
    if (live.airborne) {
      live.vy -= GRAVITY * dt;
      dy = live.vy * dt;
    }
    controller.computeColliderMovement(col, { x: mx, y: dy, z: mz });
    const m = controller.computedMovement();
    const p = b.translation();
    const next = { x: p.x + m.x, y: Math.max(GROUND_Y, p.y + m.y), z: p.z + m.z };
    if (
      live.airborne &&
      live.vy < 0 &&
      (next.y <= GROUND_Y + 1e-3 || controller.computedGrounded())
    ) {
      live.airborne = false;
      live.vy = 0;
      controller.enableSnapToGround(0.3);
    }
    b.setNextKinematicTranslation(next);
    live.player.y = next.y - GROUND_Y;
    actionRef.current.airborne = live.airborne;
    actionRef.current.sprinting = live.sprint.sprinting;
    actionRef.current.tired = live.sprint.exhausted;

    const moved = Math.hypot(m.x, m.z) / Math.max(dt, 1e-4);
    speedRef.current = speedRef.current + (moved - speedRef.current) * 0.3;
    live.speed = speedRef.current;
    live.player.x = next.x;
    live.player.z = next.z;
    if (Math.hypot(vx, vz) > 0.01) {
      const target = Math.atan2(vx, vz);
      let diff = target - live.player.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      live.player.yaw += diff * Math.min(1, dt * 12);
    }
    if (visual.current) {
      visual.current.rotation.y = live.player.yaw;
      // Sink slightly as water deepens (reads as wading).
      visual.current.position.y = -0.9 - Math.min(0.25, live.depth * 0.15);
    }

    // ── Camera placement with wall collision ─────────────────────────
    // Look target follows jumps only halfway so the view doesn't bob.
    const ty = 1.1 + (next.y - GROUND_Y) * 0.5;
    const dir = cameraDirection(cam.current.yaw, cam.current.pitch);
    const desired = cam.current.distance;
    ray.origin = { x: next.x, y: ty, z: next.z };
    ray.dir = dir;
    const hit = world.castRay(ray, desired, true, CAMERA_RAY_FLAGS, CAMERA_RAY_GROUPS, col);
    const hitAt = hit
      ? ((hit as { timeOfImpact?: number; toi?: number }).timeOfImpact ??
        (hit as { toi?: number }).toi ??
        null)
      : null;
    const allowed = collisionDistance(desired, hitAt, camCfg);
    // Pull in immediately (never clip into a wall); ease back out smoothly.
    const reduced = s.camPrefs.reducedMotion;
    camDist.current =
      allowed < camDist.current
        ? allowed
        : camDist.current + (allowed - camDist.current) * followLerp(dt, reduced) * 0.5;
    camTarget.set(next.x, ty, next.z);
    camPos.set(
      next.x + dir.x * camDist.current,
      ty + dir.y * camDist.current,
      next.z + dir.z * camDist.current,
    );
    if (allowed < desired - 1e-3) camera.position.copy(camPos);
    else camera.position.lerp(camPos, followLerp(dt, reduced));
    camera.lookAt(camTarget);
    // E2E probe: only when a test sets window.__BAHA_E2E__ before load (inert for players).
    const w = globalThis as { __BAHA_E2E__?: boolean; __bahaCam?: unknown };
    if (w.__BAHA_E2E__) {
      w.__bahaCam = {
        yaw: cam.current.yaw,
        pitch: cam.current.pitch,
        distance: cam.current.distance,
        facing: live.player.yaw,
        speed: live.speed,
      };
    }

    if (light.current) {
      light.current.target.position.set(
        next.x + Math.sin(live.player.yaw) * 6,
        0,
        next.z + Math.cos(live.player.yaw) * 6,
      );
      light.current.target.updateMatrixWorld();
    }
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={[start.x, 0.9, start.z]}
      enabledRotations={[false, false, false]}
    >
      <CapsuleCollider ref={collider} args={[0.5, 0.35]} />
      <group ref={visual} position={[0, -0.9, 0]}>
        <BlockyCharacter config={avatar} speedRef={speedRef} actionRef={actionRef} castShadow />
        {flashlight && (
          <spotLight
            ref={light}
            position={[0, 1.4, 0.2]}
            angle={0.55}
            penumbra={0.5}
            intensity={60}
            distance={22}
            color="#fff4d6"
          />
        )}
      </group>
    </RigidBody>
  );
}
