'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Fog, type AmbientLight } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { Player } from '../entities/Player';
import { EvacBeacon, Hazards, Npcs, SafePath } from '../entities/EvacEntities';
import { live, useGame } from '../store/game-store';
import { audio, haptic } from '../systems/audio';
import { registerInteractable } from '../systems/interactions';
import { currentForce, EvacLogic, type Msg } from '../systems/logic';
import { npcRuntime, resetNpcs } from '../systems/npcs';
import { Town } from '../world/Town';
import { Water } from '../world/Water';
import { Rain } from '../world/Rain';

function Atmosphere({ night }: { night: boolean }) {
  const { scene } = useThree();
  useEffect(() => {
    const sky = night ? '#0b1320' : '#7d8e9b';
    scene.background = new Color(sky);
    scene.fog = new Fog(sky, night ? 12 : 30, night ? 45 : 110);
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [night, scene]);
  return null;
}

/** Registers each NPC as an interactable (follow on interact). */
function NpcInteractions({ msg }: { msg: Msg }) {
  const layout = useGame((s) => s.layout);
  const texts = useGame((s) => s.texts);
  useEffect(() => {
    if (!layout) return;
    const offs = layout.npcs.map((n) => {
      const r = npcRuntime.get(n.id)!;
      const name = texts.npcs[n.key]?.name ?? n.key;
      return registerInteractable({
        id: `npc:${n.id}`,
        kind: 'npc',
        key: n.key,
        label: name,
        get x() {
          return r.x;
        },
        get z() {
          return r.z;
        },
        radius: 2.6,
        enabled: () => r.state === 'waiting',
        onInteract: () => {
          const g = useGame.getState();
          const needs = g.content?.npcs.find((d) => d.key === n.key)?.needs as
            { requiresItem?: string } | undefined;
          if (needs?.requiresItem && !g.packed.includes(needs.requiresItem)) {
            audio.blip('error');
            g.showHint(msg('needsCarrier', { npc: name }), 'warn', true);
            return;
          }
          r.state = 'following';
          g.follow(n.id);
          audio.blip('rescue');
          haptic(40);
          g.showHint(msg('npcFollowing', { npc: name }), 'success', true);
        },
      });
    });
    return () => offs.forEach((off) => off());
  }, [layout, texts, msg]);
  return null;
}

export function EvacScene({ avatar, msg }: { avatar: Partial<AvatarConfig> | null; msg: Msg }) {
  const layout = useGame((s) => s.layout)!;
  const config = useGame((s) => s.config)!;
  const quality = useGame((s) => s.quality);
  const content = useGame((s) => s.content);
  const hasFlashlight = useGame((s) => s.packed.includes('flashlight'));

  useMemo(() => {
    const needs: Record<string, { speedMultiplier?: number }> = {};
    for (const n of content?.npcs ?? []) needs[n.key] = n.needs as { speedMultiplier?: number };
    resetNpcs(layout.npcs, needs);
  }, [layout, content]);

  useEffect(() => {
    audio.setRain(config.rainIntensity);
    audio.siren(3);
  }, [config.rainIntensity]);

  const { bounds } = layout;
  const size: [number, number] = [bounds.maxX - bounds.minX + 80, bounds.maxZ - bounds.minZ + 80];
  const center: [number, number] = [
    (bounds.maxX + bounds.minX) / 2,
    (bounds.maxZ + bounds.minZ) / 2,
  ];
  const night = config.night;
  const shadows = quality === 'high';

  const onGroundTap = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > 8) return; // camera-orbit drag, not a tap
    // Tap-to-walk only for short distances; long trips use the joystick/keys.
    const d = Math.hypot(e.point.x - live.player.x, e.point.z - live.player.z);
    if (d < 25) useGame.getState().setMoveTarget({ x: e.point.x, z: e.point.z });
  };

  return (
    <group>
      <Atmosphere night={night} />
      <hemisphereLight
        args={[night ? '#20304a' : '#cfd8dc', night ? '#0a0f16' : '#5a4631', night ? 0.25 : 1.1]}
      />
      <directionalLight
        position={[30, 40, 20]}
        intensity={night ? 0.15 : 1.3}
        castShadow={shadows}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <Town layout={layout} shadows={shadows} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[center[0], 0.005, center[1]]}
        onClick={onGroundTap}
        visible={false}
      >
        <planeGeometry args={size} />
        <meshBasicMaterial />
      </mesh>
      <SafePath layout={layout} />
      <EvacBeacon layout={layout} />
      <Hazards hazards={layout.hazards} />
      <Npcs npcs={layout.npcs} />
      <NpcInteractions msg={msg} />
      <Water size={size} center={center} quality={quality} />
      <Rain intensity={config.rainIntensity} quality={quality} />
      <Player
        start={layout.start}
        avatar={avatar}
        cameraMode="outdoor"
        flashlight={night && hasFlashlight}
        extraForce={currentForce}
      />
      <EvacLogic msg={msg} />
      {/* Lightning: ambient light spike, thunder follows with a distance delay */}
      <LightningLight />
    </group>
  );
}

function LightningLight() {
  const ref = useRef<AmbientLight>(null);
  useFrame(() => {
    if (ref.current) ref.current.intensity = live.lightningFlash * 2.5;
  });
  return <ambientLight ref={ref} intensity={0} />;
}
