'use client';

import { forwardRef, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import type { AvatarConfig } from '@/lib/avatar/presets';

const DEFAULT: AvatarConfig = {
  v: 1,
  skin: '#C68B59',
  hair: '#1B1B1B',
  hairStyle: 'short',
  shirt: '#2F6F7E',
  pants: '#1E2A38',
  shoes: '#F2EFEA',
  hat: null,
  accessory: null,
  face: 'smile',
};

/** Per-frame action pose (mutated by the controller; never React state). */
export type CharacterAction = {
  airborne: boolean;
  sprinting: boolean;
  /** Tool swing progress 0..1 (0 = idle). */
  swing: number;
};

/**
 * Roblox-style blocky character assembled from box parts, tinted from AvatarConfig.
 * `speedRef` (m/s) drives the walk cycle and `actionRef` the jump / sprint / swing poses,
 * all without React re-renders. Height ≈ 1.8m.
 */
export const BlockyCharacter = forwardRef<
  Group,
  {
    config?: Partial<AvatarConfig> | null;
    speedRef?: { current: number };
    actionRef?: { current: CharacterAction };
    /** Tool held in the right hand (Survival). */
    tool?: 'axe' | null;
    scale?: number;
    castShadow?: boolean;
  }
>(function BlockyCharacter(
  { config, speedRef, actionRef, tool = null, scale = 1, castShadow = false },
  ref,
) {
  const c = useMemo(() => ({ ...DEFAULT, ...(config ?? {}) }), [config]);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const pose = useRef<Group>(null);
  const phase = useRef(0);
  const blend = useRef({ air: 0, lean: 0 });

  useFrame((_, dt) => {
    const s = speedRef?.current ?? 0;
    const a = actionRef?.current;
    const k = Math.min(1, dt * 12);
    blend.current.air += ((a?.airborne ? 1 : 0) - blend.current.air) * k;
    blend.current.lean += ((a?.sprinting && s > 1 ? 0.18 : 0) - blend.current.lean) * k;
    const air = blend.current.air;

    phase.current += dt * Math.min(14, 2 + s * 2.2);
    const amp = Math.min(a?.sprinting ? 1.2 : 0.9, s * 0.18) * (1 - air);
    const walk = amp * Math.sin(phase.current);
    // Jump pose: arms up and forward, knees tucked.
    const armAir = -2.5 * air;
    if (leftArm.current) leftArm.current.rotation.x = walk + armAir;
    if (rightArm.current) {
      const sw = a?.swing ?? 0;
      // Overhead chop: raise (0→0.35), strike down (0.35→0.7), recover.
      const chop =
        sw <= 0
          ? 0
          : sw < 0.35
            ? -2.6 * (sw / 0.35)
            : sw < 0.7
              ? -2.6 + 3.3 * ((sw - 0.35) / 0.35)
              : 0.7 * (1 - (sw - 0.7) / 0.3);
      rightArm.current.rotation.x = sw > 0 ? chop : -walk + armAir;
    }
    if (leftLeg.current) leftLeg.current.rotation.x = -walk - 0.6 * air;
    if (rightLeg.current) rightLeg.current.rotation.x = walk + 0.9 * air;
    if (pose.current) pose.current.rotation.x = blend.current.lean;
    if (body.current)
      body.current.position.y = 1.05 + Math.abs(Math.sin(phase.current)) * Math.min(0.05, s * 0.01);
  });

  const HAT_COLORS: Record<string, string> = {
    cap_red: '#D2402F',
    cap_blue: '#3F8FD2',
    helmet_yellow: '#F2C416',
    salakot: '#C9A66B',
    grad_cap: '#1E2A38',
  };
  const hatColor = c.hat ? (HAT_COLORS[c.hat] ?? null) : null;
  const backpack = c.accessory === 'backpack_orange' ? '#E0672A' : '#1F3A93';

  return (
    <group ref={ref} scale={scale}>
      <group ref={pose}>
        {/* legs (pivot at hip) */}
        <group ref={leftLeg} position={[-0.14, 0.72, 0]}>
          <mesh position={[0, -0.34, 0]} castShadow={castShadow}>
            <boxGeometry args={[0.24, 0.62, 0.26]} />
            <meshLambertMaterial color={c.pants} />
          </mesh>
          <mesh position={[0, -0.68, 0.03]}>
            <boxGeometry args={[0.26, 0.1, 0.32]} />
            <meshLambertMaterial color={c.shoes} />
          </mesh>
        </group>
        <group ref={rightLeg} position={[0.14, 0.72, 0]}>
          <mesh position={[0, -0.34, 0]} castShadow={castShadow}>
            <boxGeometry args={[0.24, 0.62, 0.26]} />
            <meshLambertMaterial color={c.pants} />
          </mesh>
          <mesh position={[0, -0.68, 0.03]}>
            <boxGeometry args={[0.26, 0.1, 0.32]} />
            <meshLambertMaterial color={c.shoes} />
          </mesh>
        </group>
        {/* torso */}
        <mesh ref={body} position={[0, 1.05, 0]} castShadow={castShadow}>
          <boxGeometry args={[0.56, 0.66, 0.3]} />
          <meshLambertMaterial color={c.accessory === 'vest_reflective' ? '#F2C416' : c.shirt} />
        </mesh>
        {c.accessory?.startsWith('backpack') && (
          <mesh position={[0, 1.08, -0.24]}>
            <boxGeometry args={[0.42, 0.5, 0.18]} />
            <meshLambertMaterial color={backpack} />
          </mesh>
        )}
        {c.accessory === 'badge_flame' && (
          <mesh position={[0.15, 1.2, 0.16]}>
            <boxGeometry args={[0.12, 0.14, 0.02]} />
            <meshBasicMaterial color="#E0672A" />
          </mesh>
        )}
        {c.accessory === 'apron' && (
          <mesh position={[0, 0.95, 0.16]}>
            <boxGeometry args={[0.44, 0.5, 0.02]} />
            <meshLambertMaterial color="#EEF2F3" />
          </mesh>
        )}
        {c.accessory === 'headlamp' && (
          <mesh position={[0, 1.78, 0.24]}>
            <boxGeometry args={[0.12, 0.08, 0.04]} />
            <meshBasicMaterial color="#FFF4C2" />
          </mesh>
        )}
        {/* arms (pivot at shoulder) */}
        <group ref={leftArm} position={[-0.38, 1.34, 0]}>
          <mesh position={[0, -0.3, 0]}>
            <boxGeometry args={[0.2, 0.62, 0.22]} />
            <meshLambertMaterial color={c.skin} />
          </mesh>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[0.22, 0.24, 0.24]} />
            <meshLambertMaterial color={c.shirt} />
          </mesh>
        </group>
        <group ref={rightArm} position={[0.38, 1.34, 0]}>
          <mesh position={[0, -0.3, 0]}>
            <boxGeometry args={[0.2, 0.62, 0.22]} />
            <meshLambertMaterial color={c.skin} />
          </mesh>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[0.22, 0.24, 0.24]} />
            <meshLambertMaterial color={c.shirt} />
          </mesh>
          {tool === 'axe' && (
            <group position={[0, -0.6, 0.12]}>
              {/* handle */}
              <mesh position={[0, 0, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
                <boxGeometry args={[0.06, 0.7, 0.06]} />
                <meshLambertMaterial color="#8A6B4A" />
              </mesh>
              {/* head */}
              <mesh position={[0, 0.1, 0.5]}>
                <boxGeometry args={[0.05, 0.26, 0.18]} />
                <meshLambertMaterial color="#9AA5AE" />
              </mesh>
            </group>
          )}
        </group>
        {/* head */}
        <mesh position={[0, 1.62, 0]} castShadow={castShadow}>
          <boxGeometry args={[0.46, 0.46, 0.46]} />
          <meshLambertMaterial color={c.skin} />
        </mesh>
        {/* face (front = +z) */}
        <mesh position={[-0.1, 1.66, 0.235]}>
          <boxGeometry args={[0.06, 0.08, 0.01]} />
          <meshBasicMaterial color="#1E2A38" />
        </mesh>
        <mesh position={[0.1, 1.66, 0.235]}>
          <boxGeometry args={[0.06, 0.08, 0.01]} />
          <meshBasicMaterial color="#1E2A38" />
        </mesh>
        <mesh position={[0, 1.53, 0.235]}>
          <boxGeometry args={[c.face === 'grin' ? 0.2 : 0.15, 0.035, 0.01]} />
          <meshBasicMaterial color="#1E2A38" />
        </mesh>
        {/* hair */}
        {c.hairStyle !== 'buzz' && (
          <mesh position={[0, 1.84, -0.02]}>
            <boxGeometry args={[0.48, 0.1, 0.5]} />
            <meshLambertMaterial color={c.hair} />
          </mesh>
        )}
        {c.hairStyle === 'long' && (
          <mesh position={[0, 1.55, -0.2]}>
            <boxGeometry args={[0.5, 0.5, 0.1]} />
            <meshLambertMaterial color={c.hair} />
          </mesh>
        )}
        {c.hairStyle === 'bun' && (
          <mesh position={[0, 1.95, -0.12]}>
            <boxGeometry args={[0.18, 0.16, 0.18]} />
            <meshLambertMaterial color={c.hair} />
          </mesh>
        )}
        {/* hat */}
        {hatColor && c.hat !== 'salakot' && (
          <mesh position={[0, 1.9, 0.02]}>
            <boxGeometry args={[0.52, 0.14, 0.56]} />
            <meshLambertMaterial color={hatColor} />
          </mesh>
        )}
        {c.hat === 'salakot' && (
          <mesh position={[0, 1.95, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[0.55, 0.3, 4]} />
            <meshLambertMaterial color={hatColor!} />
          </mesh>
        )}
      </group>
    </group>
  );
});
