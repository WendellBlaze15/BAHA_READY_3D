'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { RapierCollider as Collider } from '@react-three/rapier';
import { Vector3, type Group, type SpotLight } from 'three';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyCharacter } from './BlockyCharacter';
import { consumeLook, getInput } from '../systems/input';
import { depthSpeed, live, useGame } from '../store/game-store';

const BASE_SPEED = 4.6; // m/s on dry ground (config.maxSpeed caps anti-cheat at 6 × 1.2)

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
  const { world } = useRapier();
  const { camera } = useThree();
  const camTarget = useMemo(() => new Vector3(), []);
  const camPos = useMemo(() => new Vector3(), []);

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
    live.cameraYaw = cameraMode === 'indoor' ? 0.35 : 0;
  }, [start.x, start.z, cameraMode]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = useGame.getState();
    const b = body.current;
    const col = collider.current;
    const controller = controllerRef.current;
    if (!b || !col || !controller) return;
    const active = !s.paused && (s.phase === 'prep' || s.phase === 'evac');

    // Camera yaw from drag / right stick.
    live.cameraYaw += consumeLook() * 0.006;
    const yaw = live.cameraYaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: -fwd.z, z: fwd.x };

    let vx = 0;
    let vz = 0;
    if (active) {
      const input = getInput();
      if (input.x !== 0 || input.y !== 0) {
        vx = fwd.x * input.y + right.x * input.x;
        vz = fwd.z * input.y + right.z * input.x;
        if (s.moveTarget) useGame.getState().setMoveTarget(null);
      } else if (s.moveTarget) {
        const dx = s.moveTarget.x - live.player.x;
        const dz = s.moveTarget.z - live.player.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) useGame.getState().setMoveTarget(null);
        else {
          vx = dx / d;
          vz = dz / d;
        }
      }
    }

    const stamina = live.stamina < 15 ? 0.6 : 1;
    const speed = BASE_SPEED * depthSpeed(live.depth) * stamina;
    let mx = vx * speed * dt;
    let mz = vz * speed * dt;
    if (active && extraForce) {
      const f = extraForce();
      mx += f.x * dt;
      mz += f.z * dt;
    }

    controller.computeColliderMovement(col, { x: mx, y: -0.02, z: mz });
    const m = controller.computedMovement();
    const p = b.translation();
    const next = { x: p.x + m.x, y: Math.max(0.9, p.y + m.y), z: p.z + m.z };
    b.setNextKinematicTranslation(next);

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

    // Camera follow (indoor: high and close so walls don't block the view).
    const dist = cameraMode === 'indoor' ? 7.5 : 8.5;
    const height = cameraMode === 'indoor' ? 8 : 5.2;
    camPos.set(next.x + Math.sin(yaw) * dist, height, next.z + Math.cos(yaw) * dist);
    camera.position.lerp(camPos, 1 - Math.pow(0.001, dt));
    camTarget.set(next.x, 1.1, next.z);
    camera.lookAt(camTarget);

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
        <BlockyCharacter config={avatar} speedRef={speedRef} castShadow />
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
