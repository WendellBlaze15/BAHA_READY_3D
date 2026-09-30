'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DoubleSide, type Mesh, type MeshBasicMaterial, type ShaderMaterial } from 'three';
import { live, type Quality } from '../store/game-store';

const vertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vWave;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w = sin(p.x * 0.35 + uTime * 1.3) * 0.04 + cos(p.y * 0.28 + uTime * 1.1) * 0.04;
    p.z += w;
    vWave = w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uFlash;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vWave;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 uv = vUv * 90.0;
    float n = noise(uv + vec2(uTime * 0.35, uTime * 0.2)) * 0.6 + noise(uv * 2.3 - uTime * 0.25) * 0.4;
    vec3 col = mix(uDeep, uShallow, n * 0.8 + vWave * 3.0);
    float foam = smoothstep(0.78, 0.95, n);
    col = mix(col, vec3(0.86, 0.8, 0.7), foam * 0.35);
    col += uFlash * 0.45;
    gl_FragColor = vec4(col, uOpacity);
  }
`;

/** Murky floodwater plane that rises with `live.waterY`. Low quality: plain transparent plane. */
export function Water({
  size,
  center,
  quality,
}: {
  size: [number, number];
  center: [number, number];
  quality: Quality;
}) {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<ShaderMaterial>(null);
  const basic = useRef<MeshBasicMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDeep: { value: new Color('#5a4631') },
      uShallow: { value: new Color('#9a7a55') },
      uFlash: { value: 0 },
      uOpacity: { value: 0.35 },
    }),
    [],
  );

  useFrame((_, dt) => {
    if (mesh.current) mesh.current.position.y = live.waterY;
    uniforms.uTime.value += dt;
    uniforms.uFlash.value = live.lightningFlash;
    // Shallow water is see-through (roads visible); murky and opaque as it deepens.
    const opacity = 0.3 + Math.min(1, live.waterY / 0.7) * 0.58;
    uniforms.uOpacity.value = opacity;
    if (basic.current) basic.current.opacity = opacity;
  });

  return (
    <mesh
      ref={mesh}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[center[0], 0, center[1]]}
      renderOrder={2}
    >
      <planeGeometry
        args={[size[0], size[1], quality === 'low' ? 1 : 64, quality === 'low' ? 1 : 64]}
      />
      {quality === 'low' ? (
        <meshBasicMaterial
          ref={basic}
          color="#8a6b4a"
          transparent
          opacity={0.3}
          side={DoubleSide}
          depthWrite={false}
        />
      ) : (
        <shaderMaterial
          ref={mat}
          vertexShader={vertex}
          fragmentShader={fragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          side={DoubleSide}
        />
      )}
    </mesh>
  );
}
