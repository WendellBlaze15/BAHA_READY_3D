'use client';

import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  Color,
  Matrix4,
  Quaternion,
  Vector3,
  type Group,
  type InstancedMesh,
  type Mesh,
} from 'three';
import { BARANGAY_1, groundAt } from '@baha/shared/survival';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BlockyCharacter, type CharacterAction } from '@/game/entities/BlockyCharacter';
import { live } from '@/game/store/game-store';
import { bus } from './bus';
import { mapValues, useRoomState, useSession, type SyncState } from './session-store';
import { containerColor } from './World';

const st = () => useSession.getState().room?.state as SyncState | undefined;

function parseAvatar(json: string | undefined): Partial<AvatarConfig> | null {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

/**
 * Map loot containers as ONE instanced mesh (per-instance size + color); opened ones turn dark
 * (state.lootOpened). Floating debris bobs with the water.
 */
export function LootMarkers() {
  const ref = useRef<InstancedMesh>(null);
  const opened = useRef<string>('');
  const pts = BARANGAY_1.lootPoints;
  const m = useMemo(() => new Matrix4(), []);
  const q = useMemo(() => new Quaternion(), []);
  const c = useMemo(() => new Color(), []);
  useFrame(({ clock }) => {
    const im = ref.current;
    if (!im) return;
    const lo = st()?.lootOpened;
    const key = pts.map((l) => (lo?.get?.(l.id) ? '1' : '0')).join('');
    const pulse = 0.85 + Math.sin(clock.elapsedTime * 2) * 0.15;
    pts.forEach((l, i) => {
      const tall = l.container === 'cabinet' || l.container === 'shelf' || l.container === 'drum';
      const y =
        l.container === 'floating'
          ? live.waterY + Math.sin(clock.elapsedTime + i) * 0.05
          : groundAt(BARANGAY_1, l.x, l.z);
      m.compose(
        new Vector3(l.x, y + (tall ? 0.6 : 0.3), l.z),
        q,
        new Vector3(0.8, tall ? 1.2 : 0.6, 0.6),
      );
      im.setMatrixAt(i, m);
      const done = key[i] === '1';
      c.set(containerColor(l.container));
      if (done) c.multiplyScalar(0.35);
      else c.multiplyScalar(pulse * 1.15);
      im.setColorAt(i, c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    if (opened.current !== key) {
      opened.current = key;
      im.computeBoundingSphere();
    }
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pts.length]} castShadow>
      <boxGeometry />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

/** Trees, bamboo, floating debris, furniture — shrink as they're chopped. */
export function ChopTargets() {
  const refs = useRef<(Group | null)[]>([]);
  useFrame(() => {
    const chops = st()?.chops;
    BARANGAY_1.chopTargets.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      const left = chops?.get?.(c.id) ?? c.chops;
      const k = left / c.chops;
      g.visible = left > 0;
      g.scale.setScalar(0.45 + 0.55 * k);
    });
  });
  return (
    <group>
      {BARANGAY_1.chopTargets.map((c, i) => {
        const y = groundAt(BARANGAY_1, c.x, c.z);
        return (
          <group
            key={c.id}
            position={[c.x, c.kind === 'debris' ? live.waterY : y, c.z]}
            ref={(g) => {
              refs.current[i] = g;
            }}
          >
            {c.kind === 'tree' && (
              <>
                <mesh position={[0, 2.5, 0]} castShadow>
                  <cylinderGeometry args={[0.3, 0.4, 5, 8]} />
                  <meshStandardMaterial color="#6d4c41" />
                </mesh>
                <mesh position={[0, 5.5, 0]} castShadow>
                  <boxGeometry args={[3, 2.4, 3]} />
                  <meshStandardMaterial color="#2e7d32" />
                </mesh>
              </>
            )}
            {c.kind === 'bamboo' &&
              [-0.5, 0, 0.5].map((dx) => (
                <mesh key={dx} position={[dx, 3, dx * 0.6]} castShadow>
                  <cylinderGeometry args={[0.12, 0.12, 6, 6]} />
                  <meshStandardMaterial color="#7cb342" />
                </mesh>
              ))}
            {c.kind === 'debris' && (
              <mesh rotation={[0, 0.6, 0]}>
                <boxGeometry args={[2.4, 0.25, 0.6]} />
                <meshStandardMaterial color="#8d6e63" />
              </mesh>
            )}
            {c.kind === 'furniture' && (
              <mesh position={[0, 0.5, 0]}>
                <boxGeometry args={[1.6, 1, 0.8]} />
                <meshStandardMaterial color="#a1887f" />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Dropped items (incl. a fallen player's bag), supply crates, survivors and pings. */
export function DynamicEntities() {
  const ids = useRoomState(
    (s) => ({
      drops: mapValues<{ item: string; x: number; z: number }>(s.drops).map(([k, d]) => ({
        id: k,
        ...d,
      })),
      crates: mapValues<{ x: number; z: number }>(s.crates).map(([k, c]) => ({
        id: k,
        x: c.x,
        z: c.z,
      })),
      npcs: mapValues<{ state: string }>(s.npcs).map(([k]) => k),
    }),
    3,
  );
  const pings = useSession((s) => s.pings);
  return (
    <group>
      {ids?.drops.map((d) => (
        <mesh
          key={d.id}
          position={[d.x, Math.max(groundAt(BARANGAY_1, d.x, d.z), live.waterY - 0.1) + 0.2, d.z]}
        >
          <sphereGeometry args={[0.28, 8, 6]} />
          <meshStandardMaterial color="#a1887f" emissive="#ffd54f" emissiveIntensity={0.3} />
        </mesh>
      ))}
      {ids?.crates.map((c) => (
        <group
          key={c.id}
          position={[c.x, Math.max(groundAt(BARANGAY_1, c.x, c.z), live.waterY) + 0.4, c.z]}
        >
          <mesh castShadow>
            <boxGeometry args={[1, 0.8, 1]} />
            <meshStandardMaterial color="#c49a6c" />
          </mesh>
          <mesh position={[0, 2.2, 0]}>
            <sphereGeometry args={[1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#ff7043" />
          </mesh>
        </group>
      ))}
      {ids?.npcs.map((id) => (
        <Survivor key={id} id={id} />
      ))}
      {pings
        .filter((p) => p.until > Date.now())
        .map((p) => (
          <mesh key={`${p.userId}${p.until}`} position={[p.x, p.y + 2.5, p.z]}>
            <octahedronGeometry args={[0.5]} />
            <meshStandardMaterial
              color={
                p.type === 'danger'
                  ? '#e53935'
                  : p.type === 'help'
                    ? '#fb8c00'
                    : p.type === 'go'
                      ? '#43a047'
                      : '#1e88e5'
              }
              emissive="#ffffff"
              emissiveIntensity={0.4}
            />
          </mesh>
        ))}
    </group>
  );
}

const NPC_LOOK: Partial<AvatarConfig> = { shirt: '#90a4ae', pants: '#455a64', hair: '#3e2723' };

const Survivor = memo(function Survivor({ id }: { id: string }) {
  const g = useRef<Group>(null);
  const speed = useRef(0);
  const action = useRef<CharacterAction>({ airborne: false, sprinting: false, swing: 0 });
  const waving = useRef<Mesh>(null);
  useFrame(({ clock }, dt) => {
    const n = st()?.npcs?.get?.(id) as { x: number; z: number; state: string } | undefined;
    if (!g.current || !n) return;
    const tx = n.x;
    const tz = n.z;
    const dx = tx - g.current.position.x;
    const dz = tz - g.current.position.z;
    speed.current = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    g.current.position.x += dx * Math.min(1, dt * 8);
    g.current.position.z += dz * Math.min(1, dt * 8);
    g.current.position.y = Math.max(groundAt(BARANGAY_1, tx, tz), live.waterY - 0.9);
    g.current.visible = n.state === 'waiting' || n.state === 'following';
    if (waving.current)
      waving.current.visible = n.state === 'waiting' && Math.sin(clock.elapsedTime * 4) > 0;
  });
  return (
    <group ref={g}>
      <BlockyCharacter config={NPC_LOOK} speedRef={speed} actionRef={action} />
      <mesh ref={waving} position={[0, 2.6, 0]}>
        <boxGeometry args={[0.6, 0.4, 0.05]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
});

/** Teammates: interpolated (≈100 ms behind), name + chat bubble, life-state tinting. */
export function RemotePlayers() {
  const myId = useSession((s) => s.myId);
  const list = useRoomState(
    (s) =>
      mapValues<{ userId: string; username: string; avatar: string; connected: boolean }>(s.players)
        .filter(([k]) => k !== myId)
        .map(([k, p]) => ({ id: k, name: p.username, avatar: p.avatar })),
    2,
  );
  return (
    <group>
      {list?.map((p) => (
        <Remote key={p.id} id={p.id} name={p.name} avatar={p.avatar} />
      ))}
    </group>
  );
}

const Remote = memo(function Remote({
  id,
  name,
  avatar,
}: {
  id: string;
  name: string;
  avatar: string;
}) {
  const g = useRef<Group>(null);
  const speed = useRef(0);
  const action = useRef<CharacterAction>({ airborne: false, sprinting: false, swing: 0 });
  const label = useRef<HTMLDivElement>(null);
  const config = useMemo(() => parseAvatar(avatar), [avatar]);
  useFrame((_, dt) => {
    const p = st()?.players?.get?.(id) as
      | {
          x: number;
          y: number;
          z: number;
          rotY: number;
          life: string;
          sprinting: boolean;
          hingal: boolean;
          connected: boolean;
          rescued: boolean;
        }
      | undefined;
    if (!g.current || !p) return;
    const k = Math.min(1, dt * 10);
    const dx = p.x - g.current.position.x;
    const dz = p.z - g.current.position.z;
    speed.current = Math.min(12, Math.hypot(dx, dz) * 10);
    g.current.position.x += dx * k;
    g.current.position.y += (p.y - g.current.position.y) * k;
    g.current.position.z += dz * k;
    g.current.rotation.y = p.rotY;
    g.current.rotation.z = p.life === 'downed' ? Math.PI / 2.4 : 0;
    g.current.visible = p.life !== 'dead' && !p.rescued && p.connected !== false;
    action.current.sprinting = p.sprinting;
    action.current.tired = p.hingal;
    const sw = bus.swings.get(id);
    action.current.swing = sw ? Math.max(0, 1 - (performance.now() - sw) / 400) : 0;
    if (label.current) {
      const b = bus.bubbles.get(id);
      const fresh = b && performance.now() - b.at < 4000;
      label.current.dataset.bubble = fresh ? b!.text : '';
      label.current.textContent = fresh ? `${name}: ${b!.text}` : name;
      label.current.style.opacity = p.life === 'downed' ? '1' : '0.85';
      label.current.style.background = p.life === 'downed' ? '#d32f2f' : 'rgba(0,0,0,0.55)';
    }
  });
  return (
    <group ref={g}>
      <BlockyCharacter config={config} speedRef={speed} actionRef={action} />
      <Html position={[0, 2.4, 0]} center distanceFactor={14} zIndexRange={[20, 0]}>
        <div
          ref={label}
          className="max-w-[12rem] truncate rounded px-1.5 py-0.5 text-xs whitespace-nowrap text-white"
        />
      </Html>
    </group>
  );
});
