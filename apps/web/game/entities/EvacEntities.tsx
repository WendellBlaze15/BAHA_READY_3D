'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh, MeshBasicMaterial, PointLight } from 'three';
import type { HazardInstance, Layout, NpcInstance } from '@baha/shared/game';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyCharacter } from './BlockyCharacter';
import { live, useGame } from '../store/game-store';
import { npcRuntime } from '../systems/npcs';

// ── Hazards ─────────────────────────────────────────────────────────────

function LiveWire({ h }: { h: HazardInstance }) {
  const spark = useRef<PointLight>(null);
  const glow = useRef<MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    const f = Math.random() < 0.25 ? 1 : 0.15 + Math.sin(clock.elapsedTime * 30) * 0.1;
    if (spark.current) spark.current.intensity = f * 8;
    if (glow.current) glow.current.opacity = 0.35 + f * 0.5;
  });
  return (
    <group position={[h.pos.x, 0, h.pos.z]}>
      <mesh position={[0.9, 2.2, 0]} rotation={[0, 0, 0.9]}>
        <boxGeometry args={[0.3, 5.5, 0.3]} />
        <meshLambertMaterial color="#6f757a" />
      </mesh>
      <mesh position={[-0.6, 0.25, 0]} rotation={[0, 0.4, 0.05]}>
        <boxGeometry args={[3, 0.05, 0.05]} />
        <meshBasicMaterial color="#111" />
      </mesh>
      <mesh position={[-1.9, 0.3, 0]}>
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshBasicMaterial ref={glow} color="#ffe36b" transparent opacity={0.6} />
      </mesh>
      <pointLight
        ref={spark}
        position={[-1.9, 0.6, 0]}
        color="#ffe36b"
        distance={6}
        intensity={4}
      />
      {/* Warning ring: danger shown with color + shape (color-blind safe). */}
      <WarningRing radius={h.radius + 0.4} color="#d2402f" />
    </group>
  );
}

function WarningRing({ radius, color }: { radius: number; color: string }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.y = live.waterY + 0.04;
    const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.05;
    ref.current.scale.set(s, s, s);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.15, radius, 4]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}

function Manhole({ h }: { h: HazardInstance }) {
  const ref = useRef<Group>(null);
  const packedStick = useGame((s) => s.packed.includes('walking_stick'));
  useFrame(() => {
    if (!ref.current) return;
    // Hidden under murky water; revealed near the player when probing with a stick, or when dry.
    const near = Math.hypot(live.player.x - h.pos.x, live.player.z - h.pos.z) < 5;
    ref.current.visible = live.depth < 0.12 || (packedStick && near);
    ref.current.position.y = Math.max(0.03, live.waterY + 0.03);
  });
  return (
    <group ref={ref} position={[h.pos.x, 0.03, h.pos.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[h.radius, 20]} />
        <meshBasicMaterial color="#111" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[h.radius, h.radius + 0.15, 20]} />
        <meshBasicMaterial color="#f2a516" depthWrite={false} />
      </mesh>
    </group>
  );
}

function Debris({ h }: { h: HazardInstance }) {
  const ref = useRef<Group>(null);
  const phase = useMemo(() => (h.pos.x * 13.1 + h.pos.z * 7.7) % 6.28, [h]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime + phase;
    ref.current.position.set(
      h.pos.x + Math.sin(t * 0.4) * 0.4,
      Math.max(0.2, live.waterY) + Math.sin(t * 2) * 0.05,
      h.pos.z + Math.cos(t * 0.3) * 0.4,
    );
    ref.current.rotation.y = t * 0.2;
  });
  return (
    <group ref={ref}>
      <mesh>
        <boxGeometry args={[1, 0.6, 0.8]} />
        <meshLambertMaterial color="#8a5a3c" />
      </mesh>
      <mesh position={[0.6, 0.1, 0.3]} rotation={[0, 0.7, 0]}>
        <boxGeometry args={[1.8, 0.12, 0.3]} />
        <meshLambertMaterial color="#b58a5c" />
      </mesh>
      <mesh position={[-0.3, 0.2, -0.5]} rotation={[0.2, 0.3, 0]}>
        <boxGeometry args={[1.2, 0.05, 0.9]} />
        <meshLambertMaterial color="#9aa3a8" />
      </mesh>
    </group>
  );
}

function Collapsing({ h }: { h: HazardInstance }) {
  const ref = useRef<Mesh>(null);
  const hit = useGame((s) => s.hazardsHit.includes(h.id));
  useFrame((_, dt) => {
    if (!ref.current) return;
    const target = hit ? 1.35 : 0.18;
    ref.current.rotation.z += (target - ref.current.rotation.z) * Math.min(1, dt * 4);
  });
  return (
    <group position={[h.pos.x, 0, h.pos.z]}>
      <mesh ref={ref} position={[0, 1.6, 0]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[0.5, 3.2, 3]} />
        <meshLambertMaterial color="#b9a58c" />
      </mesh>
      <WarningRing radius={h.radius} color="#f2a516" />
    </group>
  );
}

function Current({ h }: { h: HazardInstance }) {
  const arrows = useRef<Group>(null);
  const dir = h.dir ?? { x: 1, z: 0 };
  const yaw = Math.atan2(dir.x, dir.z);
  useFrame(({ clock }) => {
    if (!arrows.current) return;
    arrows.current.position.y = live.waterY + 0.05;
    arrows.current.children.forEach((c, i) => {
      const t = ((clock.elapsedTime * 1.6 + i * 0.7) % 3) - 1.5;
      c.position.z = t * 2;
    });
  });
  return (
    <group position={[h.pos.x, 0, h.pos.z]} rotation={[0, yaw, 0]}>
      <group ref={arrows}>
        {[-1.4, 0, 1.4].flatMap((x) =>
          [0, 1].map((k) => (
            <mesh key={`${x}-${k}`} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.25, 0.7, 3]} />
              <meshBasicMaterial color="#e8f4f8" transparent opacity={0.8} />
            </mesh>
          )),
        )}
      </group>
    </group>
  );
}

export function Hazards({ hazards }: { hazards: HazardInstance[] }) {
  return (
    <group>
      {hazards.map((h) => {
        switch (h.key) {
          case 'live_wire':
            return <LiveWire key={h.id} h={h} />;
          case 'open_manhole':
            return <Manhole key={h.id} h={h} />;
          case 'debris':
            return <Debris key={h.id} h={h} />;
          case 'collapsing_structure':
            return <Collapsing key={h.id} h={h} />;
          case 'strong_current':
            return <Current key={h.id} h={h} />;
          default:
            return null;
        }
      })}
    </group>
  );
}

// ── NPCs ────────────────────────────────────────────────────────────────

const NPC_LOOK: Record<string, { cfg: Partial<AvatarConfig>; scale: number }> = {
  elderly: {
    cfg: { hair: '#d9d9d9', shirt: '#8e44ad', pants: '#5d4037', face: 'calm' },
    scale: 0.95,
  },
  child: { cfg: { shirt: '#f2c416', pants: '#3f8fd2', face: 'grin' }, scale: 0.62 },
  pwd: { cfg: { shirt: '#3f8fd2', pants: '#1e2a38', face: 'calm' }, scale: 1 },
};

function Npc({ n }: { n: NpcInstance }) {
  const ref = useRef<Group>(null);
  const bubble = useRef<Mesh>(null);
  const speedRef = useRef(0);
  const look = NPC_LOOK[n.key];
  useFrame(({ clock }) => {
    const r = npcRuntime.get(n.id);
    if (!r || !ref.current) return;
    ref.current.position.set(r.x, 0, r.z);
    ref.current.rotation.y = r.yaw;
    ref.current.visible = r.state !== 'rescued';
    speedRef.current = r.speed;
    if (bubble.current) {
      bubble.current.visible = r.state === 'waiting';
      bubble.current.position.y = 2.6 + Math.sin(clock.elapsedTime * 3) * 0.1;
      bubble.current.rotation.y = clock.elapsedTime;
    }
  });
  return (
    <group ref={ref} position={[n.pos.x, 0, n.pos.z]}>
      {n.key === 'pet' ? (
        <group scale={0.8}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.45, 0.4, 0.9]} />
            <meshLambertMaterial color="#c68b59" />
          </mesh>
          <mesh position={[0, 0.75, 0.5]}>
            <boxGeometry args={[0.35, 0.35, 0.35]} />
            <meshLambertMaterial color="#c68b59" />
          </mesh>
          {[-0.15, 0.15].flatMap((x) =>
            [-0.3, 0.3].map((z) => (
              <mesh key={`${x}${z}`} position={[x, 0.15, z]}>
                <boxGeometry args={[0.1, 0.3, 0.1]} />
                <meshLambertMaterial color="#8a5a3c" />
              </mesh>
            )),
          )}
        </group>
      ) : (
        <group scale={look?.scale ?? 1}>
          <BlockyCharacter config={look?.cfg} speedRef={speedRef} />
          {n.key === 'pwd' && (
            <mesh position={[0, 0.45, -0.1]}>
              <boxGeometry args={[0.7, 0.12, 0.7]} />
              <meshLambertMaterial color="#1e2a38" />
            </mesh>
          )}
          {n.key === 'elderly' && (
            <mesh position={[0.45, 0.5, 0.2]}>
              <boxGeometry args={[0.06, 1, 0.06]} />
              <meshLambertMaterial color="#6b4a33" />
            </mesh>
          )}
        </group>
      )}
      {/* "Needs help" marker */}
      <mesh ref={bubble} position={[0, 2.6, 0]}>
        <octahedronGeometry args={[0.25]} />
        <meshBasicMaterial color="#f2a516" />
      </mesh>
    </group>
  );
}

export function Npcs({ npcs }: { npcs: NpcInstance[] }) {
  return (
    <group>
      {npcs.map((n) => (
        <Npc key={n.id} n={n} />
      ))}
    </group>
  );
}

// ── Safe path + evacuation center ───────────────────────────────────────

export function SafePath({ layout }: { layout: Layout }) {
  const group = useRef<Group>(null);
  const items = useMemo(() => {
    const pts = [...layout.markers, layout.evac.center];
    return layout.markers.map((m, i) => {
      const next = pts[i + 1]!;
      return { x: m.x, z: m.z, yaw: Math.atan2(next.x - m.x, next.z - m.z) };
    });
  }, [layout]);
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.y = live.waterY + 0.06;
    group.current.children.forEach((c, i) => {
      const m = (c as Mesh).material as MeshBasicMaterial;
      m.opacity = 0.45 + 0.4 * Math.max(0, Math.sin(clock.elapsedTime * 3 - i * 0.5));
    });
  });
  return (
    <group ref={group}>
      {items.map((m, i) => (
        <mesh key={i} position={[m.x, 0, m.z]} rotation={[-Math.PI / 2, 0, m.yaw - Math.PI / 2]}>
          <circleGeometry args={[0.75, 3]} />
          <meshBasicMaterial color="#6dffae" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function EvacBeacon({ layout }: { layout: Layout }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.8;
    ref.current.position.y = 7 + Math.sin(clock.elapsedTime * 2) * 0.3;
  });
  const { x, z } = layout.evac.center;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 3.5, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 7, 6]} />
        <meshBasicMaterial color="#eef2f3" />
      </mesh>
      <mesh ref={ref} position={[0, 7, 0]}>
        <octahedronGeometry args={[0.8]} />
        <meshBasicMaterial color="#2e8b57" />
      </mesh>
      <pointLight position={[0, 6, 0]} color="#7fe0a8" intensity={20} distance={18} />
    </group>
  );
}
