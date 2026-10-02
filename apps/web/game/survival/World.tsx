'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Group, type Mesh, type MeshStandardMaterial } from 'three';
import { BARANGAY_1, type SurvivalMap } from '@baha/shared/survival';
import { Rain } from '@/game/world/Rain';
import { Water } from '@/game/world/Water';
import { live } from '@/game/store/game-store';
import type { Quality } from '@/game/store/game-store';
import { useSession } from './session-store';

const ZONE_COLOR: Record<string, string> = {
  camp_rooftops: '#b4553f',
  residential: '#c98b5a',
  palengke: '#d9a441',
  hardware: '#7f8c8d',
  health_center: '#e8eef2',
  school: '#5d8aa8',
  church: '#d8d0c0',
  power_lines: '#6b6b6b',
  lake_edge: '#3d5a40',
  rescue_shore: '#6a8f4e',
};
const CONTAINER_COLOR = {
  cabinet: '#8d6e63',
  box: '#c2a36b',
  drum: '#2e86c1',
  shelf: '#a1887f',
  floating: '#795548',
};

/** 0 (night) … 1 (noon): a 05:00–19:00 sun arc with a bright-enough morning and dusk. */
export function skyLight(minute: number) {
  const day = minute >= 300 && minute <= 1140;
  if (!day) return 0.06;
  return Math.min(1, Math.sin(((minute - 300) / 840) * Math.PI) * 1.1 + 0.25);
}

const DAY = new Color('#9ec5e6');
const NIGHT = new Color('#0b1626');
const STORM = new Color('#4a5560');

/** Sky, sun and fog follow the synced clock + weather smoothly (no jumps). */
export function Sky({ quality }: { quality: Quality }) {
  const sun = useRef<import('three').DirectionalLight>(null);
  const hemi = useRef<import('three').HemisphereLight>(null);
  const bg = useMemo(() => new Color(), []);
  useFrame(({ scene }, dt) => {
    const st = useSession.getState().room?.state as
      { minute?: number; weather?: string; waterLevel?: number } | undefined;
    const light = skyLight(st?.minute ?? 600);
    const storm = st?.weather === 'storm' ? 1 : st?.weather === 'rain' ? 0.5 : 0;
    bg.copy(NIGHT)
      .lerp(DAY, light)
      .lerp(STORM, storm * 0.6 * Math.max(0.3, light));
    scene.background = bg;
    if (scene.fog) (scene.fog as import('three').Fog).color.copy(bg);
    if (sun.current) sun.current.intensity = 0.15 + light * (1.6 - storm * 0.9);
    if (hemi.current) hemi.current.intensity = 0.25 + light * 0.6;
    // The shared floodwater/rain components read these.
    const target = st?.waterLevel ?? BARANGAY_1.baseWaterLevel;
    live.waterY += (target - live.waterY) * Math.min(1, dt * 0.5);
    live.lightningFlash = storm >= 1 && Math.random() < 0.002 ? 1 : live.lightningFlash * 0.9;
  });
  return (
    <>
      <fog attach="fog" args={['#9ec5e6', 40, quality === 'low' ? 110 : 170]} />
      <hemisphereLight ref={hemi} args={['#dbe9f5', '#3b3326', 0.7]} />
      <directionalLight
        ref={sun}
        position={[40, 80, 20]}
        intensity={1.4}
        castShadow={quality === 'high'}
      />
    </>
  );
}

export function Weather({ quality }: { quality: Quality }) {
  const weather = useSession((s) => (s.room?.state as { weather?: string } | undefined)?.weather);
  const intensity = weather === 'storm' ? 1 : weather === 'rain' ? 0.5 : 0;
  return (
    <>
      <Water size={[260, 260]} center={[0, 0]} quality={quality} />
      {intensity > 0 && <Rain intensity={intensity} quality={quality} />}
    </>
  );
}

/** Static blocky barangay: zone ground, half-submerged houses/roofs, camp props, landmarks. */
export function Barangay({ map = BARANGAY_1 }: { map?: SurvivalMap }) {
  return (
    <group>
      {map.zones.map((z) => (
        <mesh key={z.key} position={[z.rect.x, z.seabed - 0.5, z.rect.z]} receiveShadow>
          <boxGeometry args={[z.rect.w, 1, z.rect.d]} />
          <meshStandardMaterial color={z.key === 'lake_edge' ? '#2f3b2c' : '#5b4a36'} />
        </mesh>
      ))}
      {map.platforms.map((p) => {
        const base = map.zones.find((z) => z.key === p.zone)?.seabed ?? 0;
        const h = p.top - base;
        const bridge = p.id.includes('bridge');
        return (
          <group key={p.id}>
            {!bridge && (
              <mesh position={[p.x, base + h / 2 - 0.15, p.z]} castShadow receiveShadow>
                <boxGeometry args={[p.w - 0.4, h - 0.3, p.d - 0.4]} />
                <meshStandardMaterial color={ZONE_COLOR[p.zone] ?? '#aaa'} />
              </mesh>
            )}
            <mesh position={[p.x, p.top - 0.15, p.z]} castShadow receiveShadow>
              <boxGeometry args={[p.w, 0.3, p.d]} />
              <meshStandardMaterial color={bridge ? '#8d6e63' : '#6d4c41'} />
            </mesh>
          </group>
        );
      })}
      {/* Camp storage chest, campfire ring, dock planks, signal spot, rescue point flag */}
      <mesh position={[map.campStorage.x, 4.35, map.campStorage.z]} castShadow>
        <boxGeometry args={[1.4, 0.7, 0.9]} />
        <meshStandardMaterial color="#8b5a2b" />
      </mesh>
      <Campfire x={map.campFire.x} z={map.campFire.z} />
      <mesh position={[map.boatDock.x, live.waterY + 0.1, map.boatDock.z]}>
        <boxGeometry args={[map.boatDock.w, 0.2, map.boatDock.d]} />
        <meshStandardMaterial color="#7b5e3b" />
      </mesh>
      <BoatModel x={map.boatDock.x} z={map.boatDock.z} />
      <mesh position={[map.signalSpot.x, 2.6, map.signalSpot.z]}>
        <cylinderGeometry args={[1.2, 1.4, 1.2, 8]} />
        <meshStandardMaterial color="#5d4037" />
      </mesh>
      <group position={[map.rescuePoint.x, 2, map.rescuePoint.z]}>
        <mesh position={[0, 2.5, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 5]} />
          <meshStandardMaterial color="#eeeeee" />
        </mesh>
        <mesh position={[0.7, 4.4, 0]}>
          <boxGeometry args={[1.4, 0.9, 0.05]} />
          <meshStandardMaterial color="#ff6f00" emissive="#ff6f00" emissiveIntensity={0.4} />
        </mesh>
      </group>
      <HazardCues map={map} />
    </group>
  );
}

function Campfire({ x, z }: { x: number; z: number }) {
  const flame = useRef<Mesh>(null);
  const light = useRef<import('three').PointLight>(null);
  useFrame(({ clock }) => {
    const lit = !!(
      useSession.getState().room?.state as { camp?: { fireLit?: boolean } } | undefined
    )?.camp?.fireLit;
    if (flame.current) {
      flame.current.visible = lit;
      flame.current.scale.y = 1 + Math.sin(clock.elapsedTime * 12) * 0.15;
    }
    if (light.current) light.current.intensity = lit ? 6 + Math.sin(clock.elapsedTime * 9) : 0;
  });
  return (
    <group position={[x, 4.15, z]}>
      <mesh>
        <cylinderGeometry args={[0.7, 0.8, 0.25, 8]} />
        <meshStandardMaterial color="#555" />
      </mesh>
      <mesh ref={flame} position={[0, 0.5, 0]}>
        <coneGeometry args={[0.35, 0.9, 6]} />
        <meshStandardMaterial color="#ff9800" emissive="#ff5722" emissiveIntensity={2} />
      </mesh>
      <pointLight ref={light} position={[0, 1, 0]} distance={12} color="#ffb74d" />
    </group>
  );
}

/** The boat grows stage by stage (frame → hull → drums → lashing → paddles → sail). */
function BoatModel({ x, z }: { x: number; z: number }) {
  const parts = useRef<(Mesh | null)[]>([]);
  useFrame(() => {
    const stage =
      (useSession.getState().room?.state as { boat?: { stage?: number } } | undefined)?.boat
        ?.stage ?? 0;
    parts.current.forEach((m, i) => {
      if (m) m.visible = stage > i;
    });
  });
  const y = BARANGAY_1.baseWaterLevel + 0.2;
  const P = [
    { pos: [0, y + 0.3, 0], size: [1.6, 0.15, 5] },
    { pos: [0, y + 0.1, 0], size: [1.8, 0.3, 5.2] },
    { pos: [1.1, y, 0], size: [0.5, 0.5, 4] },
    { pos: [-1.1, y + 0.45, 0], size: [0.1, 0.1, 5] },
    { pos: [1.4, y + 0.6, 1], size: [0.15, 0.1, 2] },
    { pos: [0, y + 2, 0.5], size: [0.05, 2.6, 1.8] },
  ] as const;
  const colors = ['#8d6e63', '#6d4c41', '#1e88e5', '#d7ccc8', '#a1887f', '#fff3e0'];
  return (
    <group position={[x, 0, z]}>
      {P.map((p, i) => (
        <mesh
          key={i}
          ref={(m) => {
            parts.current[i] = m;
          }}
          position={p.pos as unknown as [number, number, number]}
          castShadow
        >
          <boxGeometry args={p.size as unknown as [number, number, number]} />
          <meshStandardMaterial color={colors[i]} />
        </mesh>
      ))}
    </group>
  );
}

/** Warnings come BEFORE danger: sparking wire poles, darker water for currents. */
function HazardCues({ map }: { map: SurvivalMap }) {
  const sparks = useRef<(MeshStandardMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    sparks.current.forEach((m, i) => {
      if (m) m.emissiveIntensity = Math.sin(clock.elapsedTime * 30 + i * 7) > 0.6 ? 4 : 0.2;
    });
  });
  return (
    <group>
      {map.hazards
        .filter((h) => h.kind === 'live_wire')
        .map((h, i) => (
          <group key={h.id} position={[h.rect.x, 0, h.rect.z]}>
            <mesh position={[0, 3, 0]} rotation={[0, 0, 0.35]}>
              <cylinderGeometry args={[0.15, 0.2, 7]} />
              <meshStandardMaterial color="#8d8d8d" />
            </mesh>
            <mesh position={[0, live.waterY + 0.2, 0]}>
              <sphereGeometry args={[0.25, 8, 8]} />
              <meshStandardMaterial
                ref={(m) => {
                  sparks.current[i] = m;
                }}
                color="#fff59d"
                emissive="#ffeb3b"
              />
            </mesh>
          </group>
        ))}
      {map.hazards
        .filter((h) => h.kind === 'current')
        .map((h) => (
          <mesh
            key={h.id}
            position={[h.rect.x, BARANGAY_1.baseWaterLevel + 0.05, h.rect.z]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <planeGeometry args={[h.rect.w, h.rect.d]} />
            <meshStandardMaterial color="#1b3b4f" transparent opacity={0.35} />
          </mesh>
        ))}
    </group>
  );
}

export function containerColor(c: keyof typeof CONTAINER_COLOR) {
  return CONTAINER_COLOR[c];
}

export type { Group };
