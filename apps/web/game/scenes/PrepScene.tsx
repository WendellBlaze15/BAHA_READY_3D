'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { Group, Mesh } from 'three';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { Player } from '../entities/Player';
import { live, useGame } from '../store/game-store';
import { audio, haptic } from '../systems/audio';
import { distanceTo, registerInteractable } from '../systems/interactions';
import { PrepLogic, type Msg } from '../systems/logic';

const ROOM = { w: 14, d: 10 };

// Where go-bag items sit (tables, shelves, floor). Deterministic by item order.
const ITEM_SLOTS: [number, number, number][] = [
  [-2.5, 0.95, -1],
  [-1.5, 0.95, -1],
  [-0.5, 0.95, -1],
  [0.5, 0.95, -1],
  [1.5, 0.95, -1],
  [-2.5, 0.95, 0.4],
  [-1.5, 0.95, 0.4],
  [-0.5, 0.95, 0.4],
  [0.5, 0.95, 0.4],
  [1.5, 0.95, 0.4],
  [4.2, 1.35, 4.3],
  [5.2, 1.35, 4.3],
  [6.1, 1.35, 4.3],
  [-4.8, 0.3, 4.2],
  [-3.8, 0.3, 4.2],
  [3.2, 0.3, 1.5],
  [4.2, 0.3, 1.5],
  [-5.6, 0.3, 0.8],
  [2.6, 0.95, -1],
  [2.6, 0.95, 0.4],
];

const TASK_STATIONS: Record<string, [number, number]> = {
  switch_off_breaker: [-6.4, -2.5],
  elevate_appliances: [-3.8, -4.1],
  secure_documents: [5.3, -4.1],
  charge_devices: [1.6, -4.1],
  bring_pets_inside: [5.6, 2.6],
  fill_water_containers: [-6.1, 2.6],
  secure_outdoor_items: [6.3, -1.2],
};

const CATEGORY_COLOR: Record<string, string> = {
  water: '#3f8fd2',
  food: '#f2a516',
  light: '#f2c416',
  health: '#d2402f',
  communication: '#2f6f7e',
  documents: '#8a6b4a',
  clothing: '#8e44ad',
  hygiene: '#9fd3c7',
  money: '#2e8b57',
  tools: '#6b4a33',
  pet: '#c68b59',
  non_essential: '#7f8c8d',
};

function makeTap(onNear: () => void, id: string, pos: { x: number; z: number }) {
  return (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (distanceTo(id) < 2.4) onNear();
    else useGame.getState().setMoveTarget({ x: pos.x, z: pos.z + 1.2 });
  };
}

function ItemPickup({
  itemKey,
  slot,
  msg,
}: {
  itemKey: string;
  slot: [number, number, number];
  msg: Msg;
}) {
  const packed = useGame((s) => s.packed.includes(itemKey));
  const def = useGame((s) => s.content?.items.find((i) => i.key === itemKey));
  const name = useGame((s) => s.texts.items[itemKey]?.name ?? itemKey);
  const ref = useRef<Group>(null);
  const [hover, setHover] = useState(false);
  const id = `item:${itemKey}`;

  const interact = () => {
    const g = useGame.getState();
    const res = g.pack(itemKey);
    if (res === 'overweight') {
      audio.blip('error');
      haptic(80);
      g.showHint(msg('overweight', { item: name }), 'warn', true);
    } else {
      audio.blip(res === 'packed' ? 'pack' : 'unpack');
      g.showHint(
        msg(res === 'packed' ? 'packed' : 'unpacked', { item: name, kg: def?.weight_kg ?? 0 }),
        'info',
        true,
      );
      if (g.config?.tutorial && res === 'packed' && g.tutorialStep === 1) g.setTutorialStep(2);
    }
  };

  useEffect(
    () =>
      registerInteractable({
        id,
        kind: 'item',
        key: itemKey,
        label: name,
        x: slot[0],
        z: slot[2],
        enabled: () => !useGame.getState().packed.includes(itemKey),
        onInteract: interact,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [itemKey, name],
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.rotation.y = clock.elapsedTime * 0.8;
    const near = live.interactTarget?.key === itemKey;
    ref.current.scale.setScalar(hover || near ? 1.15 : 1);
  });

  if (packed || !def) return null;
  const heavy = def.weight_kg >= 2;
  return (
    <group
      ref={ref}
      position={slot}
      onClick={makeTap(interact, id, { x: slot[0], z: slot[2] })}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
    >
      <mesh position={[0, heavy ? 0.25 : 0.15, 0]}>
        <boxGeometry args={heavy ? [0.7, 0.5, 0.5] : [0.35, 0.3, 0.25]} />
        <meshLambertMaterial
          color={CATEGORY_COLOR[def.category] ?? '#999'}
          emissive={hover ? '#f2a516' : '#000'}
          emissiveIntensity={0.35}
        />
      </mesh>
      {/* floating marker */}
      <mesh position={[0, heavy ? 0.85 : 0.65, 0]}>
        <octahedronGeometry args={[0.1]} />
        <meshBasicMaterial color="#f2a516" />
      </mesh>
    </group>
  );
}

function TaskStation({ taskKey, msg }: { taskKey: string; msg: Msg }) {
  const done = useGame((s) => s.tasksDone.includes(taskKey));
  const name = useGame((s) => s.texts.tasks[taskKey]?.name ?? taskKey);
  const [x, z] = TASK_STATIONS[taskKey] ?? [0, -4];
  const id = `task:${taskKey}`;
  const moving = useRef<Group>(null);

  const interact = () => {
    const g = useGame.getState();
    if (g.doTask(taskKey)) {
      audio.blip('task');
      haptic(30);
      g.showHint(msg('taskDone', { task: name }), 'success', true);
      if (g.config?.tutorial && g.tutorialStep === 2) g.setTutorialStep(3);
    }
  };

  useEffect(
    () =>
      registerInteractable({
        id,
        kind: 'task',
        key: taskKey,
        label: name,
        x,
        z,
        enabled: () => !useGame.getState().tasksDone.includes(taskKey),
        onInteract: interact,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskKey, name],
  );

  useFrame((_, dt) => {
    if (!moving.current) return;
    const target = done ? 1 : 0;
    moving.current.userData.t =
      (moving.current.userData.t ?? 0) +
      (target - (moving.current.userData.t ?? 0)) * Math.min(1, dt * 5);
  });

  const tap = makeTap(interact, id, { x, z });
  const glow = done ? '#2e8b57' : '#f2a516';

  const body = (() => {
    switch (taskKey) {
      case 'switch_off_breaker':
        return (
          <group position={[0, 1.5, 0]}>
            <mesh>
              <boxGeometry args={[0.2, 0.8, 0.6]} />
              <meshLambertMaterial color="#9aa3a8" />
            </mesh>
            <mesh position={[0.12, done ? -0.15 : 0.15, 0]}>
              <boxGeometry args={[0.08, 0.25, 0.12]} />
              <meshBasicMaterial color={done ? '#2e8b57' : '#d2402f'} />
            </mesh>
          </group>
        );
      case 'elevate_appliances':
        return (
          <group>
            <mesh position={[0, 0.35, 0]}>
              <boxGeometry args={[1.8, 0.7, 0.6]} />
              <meshLambertMaterial color="#8a5a3c" />
            </mesh>
            <mesh position={[0, 2.1, -0.1]}>
              <boxGeometry args={[2, 0.12, 0.5]} />
              <meshLambertMaterial color="#6b4a33" />
            </mesh>
            <mesh position={[0, done ? 2.55 : 1.05, 0]}>
              <boxGeometry args={[1.2, 0.75, 0.15]} />
              <meshLambertMaterial color="#1e2a38" />
            </mesh>
          </group>
        );
      case 'secure_documents':
        return (
          <group>
            <mesh position={[0, 0.6, 0]}>
              <boxGeometry args={[1, 1.2, 0.6]} />
              <meshLambertMaterial color="#b58a5c" />
            </mesh>
            {!done && (
              <mesh position={[0, 1.25, 0]}>
                <boxGeometry args={[0.5, 0.08, 0.4]} />
                <meshLambertMaterial color="#f2e6c9" />
              </mesh>
            )}
          </group>
        );
      case 'charge_devices':
        return (
          <group>
            <mesh position={[0, 0.45, 0]}>
              <boxGeometry args={[1.2, 0.9, 0.6]} />
              <meshLambertMaterial color="#c7b199" />
            </mesh>
            <mesh position={[0, 0.95, 0]}>
              <boxGeometry args={[0.2, 0.04, 0.38]} />
              <meshBasicMaterial color={done ? '#2e8b57' : '#d2402f'} />
            </mesh>
          </group>
        );
      case 'bring_pets_inside':
        return (
          <group position={[done ? -2 : 0, 0, done ? -0.5 : 0]}>
            <mesh position={[0, 0.35, 0]}>
              <boxGeometry args={[0.4, 0.35, 0.8]} />
              <meshLambertMaterial color="#c68b59" />
            </mesh>
            <mesh position={[0, 0.62, 0.45]}>
              <boxGeometry args={[0.3, 0.3, 0.3]} />
              <meshLambertMaterial color="#c68b59" />
            </mesh>
          </group>
        );
      case 'fill_water_containers':
        return (
          <group>
            <mesh position={[0, 0.45, 0]}>
              <boxGeometry args={[1.2, 0.9, 0.7]} />
              <meshLambertMaterial color="#dfe8ee" />
            </mesh>
            {[-0.3, 0.3].map((dx) => (
              <mesh key={dx} position={[dx, 1.15, 0]}>
                <boxGeometry args={[0.35, 0.5, 0.35]} />
                <meshLambertMaterial
                  color={done ? '#3f8fd2' : '#eef2f3'}
                  transparent
                  opacity={0.9}
                />
              </mesh>
            ))}
          </group>
        );
      case 'secure_outdoor_items':
        return (
          <group position={[done ? -1 : 0, 0, 0]}>
            {[-0.5, 0.5].map((dz) => (
              <mesh key={dz} position={[0, 0.3, dz]}>
                <boxGeometry args={[0.45, 0.6, 0.45]} />
                <meshLambertMaterial color="#b04a34" />
              </mesh>
            ))}
          </group>
        );
      default:
        return (
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.8, 1, 0.8]} />
            <meshLambertMaterial color="#9aa3a8" />
          </mesh>
        );
    }
  })();

  return (
    <group position={[x, 0, z]} onClick={tap}>
      <group ref={moving}>{body}</group>
      <mesh position={[0, 0.02, 0.9]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.5, 20]} />
        <meshBasicMaterial color={glow} transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function Room() {
  const floorTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    useGame.getState().setMoveTarget({ x: e.point.x, z: e.point.z });
  };
  const wall = '#f2e6c9';
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={floorTap}>
        <planeGeometry args={[ROOM.w, ROOM.d]} />
        <meshLambertMaterial color="#c9a66b" />
      </mesh>
      {/* floor planks */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[-ROOM.w / 2 + 1 + i * 2, 0.005, 0]}
        >
          <planeGeometry args={[0.04, ROOM.d]} />
          <meshBasicMaterial color="#a88350" />
        </mesh>
      ))}
      {/* walls: back, left, right (front open for the camera) */}
      <mesh position={[0, 1.6, -ROOM.d / 2]}>
        <boxGeometry args={[ROOM.w, 3.2, 0.3]} />
        <meshLambertMaterial color={wall} />
      </mesh>
      <mesh position={[-ROOM.w / 2, 1.6, 0]}>
        <boxGeometry args={[0.3, 3.2, ROOM.d]} />
        <meshLambertMaterial color={wall} />
      </mesh>
      <mesh position={[ROOM.w / 2, 1.6, 0]}>
        <boxGeometry args={[0.3, 3.2, ROOM.d]} />
        <meshLambertMaterial color={wall} />
      </mesh>
      {/* window */}
      <mesh position={[ROOM.w / 2 - 0.16, 1.8, -1.2]}>
        <boxGeometry args={[0.05, 1.2, 1.6]} />
        <meshBasicMaterial color="#7a93a8" />
      </mesh>
      {/* table + shelf */}
      <mesh position={[0, 0.4, -0.3]}>
        <boxGeometry args={[6.6, 0.8, 2.4]} />
        <meshLambertMaterial color="#8a5a3c" />
      </mesh>
      <mesh position={[5.1, 0.6, 4.3]}>
        <boxGeometry args={[3, 1.2, 0.8]} />
        <meshLambertMaterial color="#6b4a33" />
      </mesh>
      {/* door (exit) */}
      <mesh position={[0, 1.2, ROOM.d / 2 + 0.2]}>
        <boxGeometry args={[1.6, 2.4, 0.1]} />
        <meshLambertMaterial color="#6b4a33" />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[ROOM.w / 2, 2, 0.2]} position={[0, 2, -ROOM.d / 2]} />
        <CuboidCollider args={[ROOM.w / 2, 2, 0.2]} position={[0, 2, ROOM.d / 2 + 0.3]} />
        <CuboidCollider args={[0.2, 2, ROOM.d / 2]} position={[-ROOM.w / 2, 2, 0]} />
        <CuboidCollider args={[0.2, 2, ROOM.d / 2]} position={[ROOM.w / 2, 2, 0]} />
        <CuboidCollider args={[3.3, 0.5, 1.2]} position={[0, 0.5, -0.3]} />
        <CuboidCollider args={[1.5, 0.6, 0.4]} position={[5.1, 0.6, 4.3]} />
      </RigidBody>
    </group>
  );
}

export function PrepScene({ avatar, msg }: { avatar: Partial<AvatarConfig> | null; msg: Msg }) {
  const config = useGame((s) => s.config);
  const items = useMemo(() => config?.items ?? [], [config]);
  const tasks = useMemo(() => config?.homeTasks ?? [], [config]);
  const lamp = useRef<Mesh>(null);
  const breakerOff = useGame((s) => s.tasksDone.includes('switch_off_breaker'));

  return (
    <group>
      <hemisphereLight args={['#fff6e5', '#6b5a45', breakerOff ? 0.9 : 1.2]} />
      <directionalLight position={[4, 10, 6]} intensity={breakerOff ? 0.8 : 1.4} />
      <pointLight
        position={[0, 3, 0]}
        intensity={breakerOff ? 0 : 12}
        distance={12}
        color="#ffe9b0"
      />
      <mesh ref={lamp} position={[0, 3.1, 0]}>
        <boxGeometry args={[0.4, 0.15, 0.4]} />
        <meshBasicMaterial color={breakerOff ? '#555' : '#fff4c2'} />
      </mesh>
      <Room />
      {items.map((k, i) => (
        <ItemPickup key={k} itemKey={k} slot={ITEM_SLOTS[i % ITEM_SLOTS.length]!} msg={msg} />
      ))}
      {tasks.map((k) => (
        <TaskStation key={k} taskKey={k} msg={msg} />
      ))}
      <Player start={{ x: 0, z: 3 }} avatar={avatar} cameraMode="indoor" />
      <PrepLogic msg={msg} />
    </group>
  );
}
