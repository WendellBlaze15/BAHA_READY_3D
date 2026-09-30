'use client';

import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  BoxGeometry,
  ShaderMaterial,
} from 'three';
import type { Quality } from '../store/game-store';

const COUNT: Record<Quality, number> = { low: 1000, medium: 4000, high: 10000 };
const AREA = 44;
const HEIGHT = 22;

/**
 * GPU rain (Section 9.7): each streak's fall is computed in the vertex shader from time and a
 * per-instance seed, so the CPU cost is one uniform update per frame regardless of count.
 */
export function Rain({ intensity, quality }: { intensity: number; quality: Quality }) {
  const count = Math.max(150, Math.round(COUNT[quality] * Math.max(0.15, intensity)));
  const { camera } = useThree();

  const { geometry, material } = useMemo(() => {
    const base = new BoxGeometry(0.02, 0.6, 0.02);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.attributes.position = base.attributes.position!;
    g.instanceCount = count;
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = Math.random() * AREA - AREA / 2;
      seeds[i * 4 + 1] = Math.random() * HEIGHT;
      seeds[i * 4 + 2] = Math.random() * AREA - AREA / 2;
      seeds[i * 4 + 3] = 14 + Math.random() * 8;
    }
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
    const m = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: [0, 0, 0] } },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCam;
        void main() {
          float y = mod(aSeed.y - aSeed.w * uTime, ${HEIGHT.toFixed(1)});
          // Wrap horizontally around the camera so rain always surrounds the player.
          vec2 xz = mod(aSeed.xz - uCam.xz + ${(AREA / 2).toFixed(1)}, ${AREA.toFixed(1)}) - ${(AREA / 2).toFixed(1)} + uCam.xz;
          vec3 p = position + vec3(xz.x, y, xz.y);
          p.x += position.y * 0.12;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        void main() { gl_FragColor = vec4(0.81, 0.89, 0.93, 0.45); }
      `,
    });
    return { geometry: g, material: m };
  }, [count]);

  // Dispose GPU buffers on unmount / quality change (no memory growth across levels).
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
    material.uniforms.uCam!.value = [camera.position.x, 0, camera.position.z];
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
