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

/**
 * Roblox-style blocky character assembled from box parts, tinted from AvatarConfig.
 * `speedRef` (m/s) drives the walk cycle without React re-renders. Height ≈ 1.8m.
 */
export const BlockyCharacter = forwardRef<
  Group,
  {
    config?: Partial<AvatarConfig> | null;
    speedRef?: { current: number };
    scale?: number;
    castShadow?: boolean;
  }
>(function BlockyCharacter({ config, speedRef, scale = 1, castShadow = false }, ref) {
  const c = useMemo(() => ({ ...DEFAULT, ...(config ?? {}) }), [config]);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const phase = useRef(0);

  useFrame((_, dt) => {
    const s = speedRef?.current ?? 0;
    phase.current += dt * Math.min(12, 2 + s * 2.2);
    const swing = Math.min(0.9, s * 0.18) * Math.sin(phase.current);
    if (leftArm.current) leftArm.current.rotation.x = swing;
    if (rightArm.current) rightArm.current.rotation.x = -swing;
    if (leftLeg.current) leftLeg.current.rotation.x = -swing;
    if (rightLeg.current) rightLeg.current.rotation.x = swing;
    if (body.current)
      body.current.position.y = 1.05 + Math.abs(Math.sin(phase.current)) * Math.min(0.05, s * 0.01);
  });

  const hatColor =
    c.hat === 'cap_red'
      ? '#D2402F'
      : c.hat === 'helmet_yellow'
        ? '#F2C416'
        : c.hat === 'salakot'
          ? '#C9A66B'
          : null;

  return (
    <group ref={ref} scale={scale}>
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
          <meshLambertMaterial color="#1F3A93" />
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
  );
});
