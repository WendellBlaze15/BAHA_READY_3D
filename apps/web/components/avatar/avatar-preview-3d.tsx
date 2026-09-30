'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BlockyCharacter } from '@/game/entities/BlockyCharacter';
import type { AvatarConfig } from '@/lib/avatar/presets';

/** Small on-demand canvas (frameloop="demand": renders only on interaction). */
export default function AvatarPreview3D({ config }: { config: Partial<AvatarConfig> }) {
  return (
    <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ position: [0, 1.3, 3.4], fov: 40 }}>
      <hemisphereLight args={['#ffffff', '#8a6b4a', 1.3]} />
      <directionalLight position={[2, 4, 3]} intensity={1.2} />
      <group position={[0, -0.9, 0]}>
        <BlockyCharacter config={config} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.9, 24]} />
          <meshLambertMaterial color="#2f6f7e" />
        </mesh>
      </group>
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={1.1}
        maxPolarAngle={1.6}
        target={[0, 0.1, 0]}
      />
    </Canvas>
  );
}
