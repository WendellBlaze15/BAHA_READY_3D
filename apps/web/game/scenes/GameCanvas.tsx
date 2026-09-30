'use client';

import { Suspense, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { AdaptiveDpr, PerformanceMonitor } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { useGame } from '../store/game-store';
import { PrepScene } from './PrepScene';
import { EvacScene } from './EvacScene';
import { clearInteractables } from '../systems/interactions';
import { inputActions } from '../systems/input';
import type { Msg } from '../systems/logic';
import { isMobileDevice as isMobile } from '../systems/quality';

export default function GameCanvas({
  avatar,
  msg,
}: {
  avatar: Partial<AvatarConfig> | null;
  msg: Msg;
}) {
  const phase = useGame((s) => s.phase);
  const paused = useGame((s) => s.paused);
  const quality = useGame((s) => s.quality);
  const scene = phase === 'evac' || phase === 'ended' ? 'evac' : 'prep';

  useEffect(() => clearInteractables, [scene]);

  const playing = (phase === 'prep' || phase === 'evac') && !paused;
  // Active pointers for orbit drags and pinch-zoom (ref: never re-renders).
  const pointers = useRef(new Map<number, { x: number; y: number; look: boolean }>()).current;
  const maxDpr = isMobile() ? 1.5 : 2;

  return (
    <Canvas
      className="touch-none"
      // Render continuously only while playing; on demand otherwise (menus, pause, results).
      frameloop={playing ? 'always' : 'demand'}
      dpr={[1, quality === 'low' ? 1 : maxDpr]}
      shadows={quality === 'high'}
      gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
      camera={{ fov: 55, near: 0.1, far: 300, position: [0, 8, 10] }}
      onPointerDown={(e) => {
        pointers.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
          // Mouse drags anywhere orbit; touch orbits from the right half (left = joystick side).
          look: e.pointerType === 'mouse' || e.clientX > window.innerWidth / 2,
        });
      }}
      onPointerMove={(e) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        const touches = [...pointers.values()];
        if (e.pointerType === 'touch' && touches.length >= 2) {
          // Two-finger pinch → zoom (fingers apart = zoom in).
          const [a, b] = touches;
          const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          p.x = e.clientX;
          p.y = e.clientY;
          const after = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          inputActions.addZoom((before - after) * 4);
          return;
        }
        p.x = e.clientX;
        p.y = e.clientY;
        if (p.look && (e.pointerType !== 'mouse' || e.buttons !== 0)) inputActions.addLook(dx, dy);
      }}
      onPointerUp={(e) => pointers.delete(e.pointerId)}
      onPointerCancel={(e) => pointers.delete(e.pointerId)}
      onPointerLeave={(e) => pointers.delete(e.pointerId)}
      onWheel={(e) => inputActions.addZoom(e.deltaY)}
    >
      <PerformanceMonitor
        onDecline={() => {
          const q = useGame.getState().quality;
          if (q === 'high') useGame.setState({ quality: 'medium' });
          else if (q === 'medium') useGame.setState({ quality: 'low' });
        }}
      />
      <AdaptiveDpr pixelated />
      <Suspense fallback={null}>
        <Physics timeStep={1 / 60} interpolate paused={!playing} gravity={[0, -9.81, 0]}>
          {scene === 'prep' ? (
            <PrepScene avatar={avatar} msg={msg} />
          ) : (
            <EvacScene avatar={avatar} msg={msg} />
          )}
        </Physics>
      </Suspense>
    </Canvas>
  );
}
