'use client';

import { Suspense, useEffect } from 'react';
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
      onPointerMove={(e) => {
        // Drag with the mouse (or on the right half on touch) to rotate the camera.
        if (e.buttons === 1 && (e.pointerType === 'mouse' || e.clientX > window.innerWidth / 2)) {
          inputActions.addLook(e.movementX);
        }
      }}
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
