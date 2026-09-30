'use client';

import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { NOT_CAMERA_BLOCKING } from '../systems/camera-groups';
import { Color, InstancedMesh, Object3D } from 'three';
import type { Building, Layout, Prop } from '@baha/shared/game';

const tmp = new Object3D();
const col = new Color();

/** One InstancedMesh per part type: walls, roofs, windows (Section 9.7 performance). */
function Buildings({ buildings, shadows }: { buildings: Building[]; shadows: boolean }) {
  const walls = useRef<InstancedMesh>(null);
  const roofs = useRef<InstancedMesh>(null);
  const bands = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    buildings.forEach((b, i) => {
      tmp.position.set(b.x, b.h / 2, b.z);
      tmp.scale.set(b.w, b.h, b.d);
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      walls.current!.setMatrixAt(i, tmp.matrix);
      walls.current!.setColorAt(i, col.setHex(b.color));

      tmp.position.set(b.x, b.h + 0.35, b.z);
      tmp.scale.set(b.w + 0.6, 0.7, b.d + 0.6);
      tmp.updateMatrix();
      roofs.current!.setMatrixAt(i, tmp.matrix);
      roofs.current!.setColorAt(i, col.setHex(b.roof));

      // Window band: a darker inset strip reads as windows from a distance.
      tmp.position.set(b.x, Math.min(b.h - 0.9, 2.2), b.z);
      tmp.scale.set(b.w + 0.04, 0.7, b.d + 0.04);
      tmp.updateMatrix();
      bands.current!.setMatrixAt(i, tmp.matrix);
      bands.current!.setColorAt(i, col.setHex(b.kind === 'evac_center' ? 0x2e8b57 : 0x4a6378));
    });
    for (const m of [walls, roofs, bands]) {
      m.current!.instanceMatrix.needsUpdate = true;
      if (m.current!.instanceColor) m.current!.instanceColor.needsUpdate = true;
      m.current!.computeBoundingSphere();
    }
  }, [buildings]);

  return (
    <group>
      <instancedMesh
        ref={walls}
        args={[undefined, undefined, buildings.length]}
        castShadow={shadows}
        receiveShadow
      >
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh
        ref={roofs}
        args={[undefined, undefined, buildings.length]}
        castShadow={shadows}
      >
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={bands} args={[undefined, undefined, buildings.length]}>
        <boxGeometry />
        <meshLambertMaterial />
      </instancedMesh>
    </group>
  );
}

function PropMesh({ p }: { p: Prop }) {
  switch (p.kind) {
    case 'tree':
      return (
        <group position={[p.x, 0, p.z]}>
          <mesh position={[0, 1.2, 0]}>
            <boxGeometry args={[0.5, 2.4, 0.5]} />
            <meshLambertMaterial color="#6b4a33" />
          </mesh>
          <mesh position={[0, 3, 0]}>
            <boxGeometry args={[2.6, 2, 2.6]} />
            <meshLambertMaterial color="#2e8b57" />
          </mesh>
        </group>
      );
    case 'post':
      return (
        <mesh position={[p.x, 3, p.z]}>
          <boxGeometry args={[0.3, 6, 0.3]} />
          <meshLambertMaterial color="#8a8f94" />
        </mesh>
      );
    case 'fountain':
      return (
        <group position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[3, 3.2, 1, 8]} />
            <meshLambertMaterial color="#d9d9d9" />
          </mesh>
          <mesh position={[0, 1.6, 0]}>
            <boxGeometry args={[0.8, 2.2, 0.8]} />
            <meshLambertMaterial color="#c7b199" />
          </mesh>
        </group>
      );
    case 'bench':
      return (
        <mesh position={[p.x, 0.4, p.z]} rotation={[0, p.rot, 0]}>
          <boxGeometry args={[2, 0.4, 0.6]} />
          <meshLambertMaterial color="#8a5a3c" />
        </mesh>
      );
    case 'stall':
      return (
        <group position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[3.2, 1, 2]} />
            <meshLambertMaterial color="#c7b199" />
          </mesh>
          <mesh position={[0, 2.4, 0]}>
            <boxGeometry args={[3.6, 0.2, 2.6]} />
            <meshLambertMaterial color={p.color ?? 0xd2402f} />
          </mesh>
          {[-1.5, 1.5].map((x) => (
            <mesh key={x} position={[x, 1.2, 1]}>
              <boxGeometry args={[0.15, 2.4, 0.15]} />
              <meshLambertMaterial color="#6b4a33" />
            </mesh>
          ))}
        </group>
      );
    case 'jeepney':
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rot, 0]}>
          <mesh position={[0, 1.1, 0]}>
            <boxGeometry args={[2.2, 1.6, 5.2]} />
            <meshLambertMaterial color="#e8e2d2" />
          </mesh>
          <mesh position={[0, 1.2, 0]}>
            <boxGeometry args={[2.25, 0.35, 5.25]} />
            <meshLambertMaterial color="#d2402f" />
          </mesh>
          <mesh position={[0, 2.05, 0]}>
            <boxGeometry args={[2.3, 0.2, 5.4]} />
            <meshLambertMaterial color="#3f8fd2" />
          </mesh>
        </group>
      );
    case 'tricycle':
      return (
        <group position={[p.x, 0, p.z]} rotation={[0, p.rot, 0]}>
          <mesh position={[0, 0.9, 0]}>
            <boxGeometry args={[1.4, 1.3, 2.2]} />
            <meshLambertMaterial color="#2f6f7e" />
          </mesh>
        </group>
      );
    case 'court':
      return (
        <mesh position={[p.x, 0.02, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[14, 9]} />
          <meshLambertMaterial color="#b75a3c" />
        </mesh>
      );
    case 'sign':
      return (
        <group position={[p.x, 0, p.z]}>
          <mesh position={[0, 1.5, 0]}>
            <boxGeometry args={[0.2, 3, 0.2]} />
            <meshLambertMaterial color="#1e2a38" />
          </mesh>
          <mesh position={[0, 3.2, 0]}>
            <boxGeometry args={[2.4, 1.2, 0.15]} />
            <meshBasicMaterial color="#2e8b57" />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

/** Static town geometry + one fixed rigid body holding every building collider. */
export const Town = memo(function Town({ layout, shadows }: { layout: Layout; shadows: boolean }) {
  const { bounds } = layout;
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const cx = (bounds.maxX + bounds.minX) / 2;
  const cz = (bounds.maxZ + bounds.minZ) / 2;
  const colliders = useMemo(() => layout.buildings, [layout]);

  return (
    <group>
      {/* ground (blocks) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow>
        <planeGeometry args={[w + 60, d + 60]} />
        <meshLambertMaterial color="#7a8f5a" />
      </mesh>
      {/* roads */}
      {layout.roadsX.map((x) => (
        <mesh key={`rx${x}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.01, cz]} receiveShadow>
          <planeGeometry args={[layout.roadWidth, d]} />
          <meshLambertMaterial color="#5b6168" />
        </mesh>
      ))}
      {layout.roadsZ.map((z) => (
        <mesh
          key={`rz${z}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[cx, 0.012, z]}
          receiveShadow
        >
          <planeGeometry args={[w, layout.roadWidth]} />
          <meshLambertMaterial color="#5b6168" />
        </mesh>
      ))}
      {/* evacuation center pad */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[layout.evac.center.x, 0.03, layout.evac.center.z]}
      >
        <circleGeometry args={[layout.evac.radius, 24]} />
        <meshLambertMaterial color="#2e8b57" />
      </mesh>

      <Buildings buildings={layout.buildings} shadows={shadows} />
      {layout.props.map((p, i) => (
        <PropMesh key={i} p={p} />
      ))}

      <RigidBody type="fixed" colliders={false}>
        {colliders.map((b, i) => (
          <CuboidCollider
            key={i}
            args={[b.w / 2, b.h / 2, b.d / 2]}
            position={[b.x, b.h / 2, b.z]}
          />
        ))}
        {/* world bounds (invisible: block the player, never the camera) */}
        <CuboidCollider
          args={[w / 2 + 2, 3, 0.5]}
          position={[cx, 3, bounds.minZ - 0.5]}
          collisionGroups={NOT_CAMERA_BLOCKING}
        />
        <CuboidCollider
          args={[w / 2 + 2, 3, 0.5]}
          position={[cx, 3, bounds.maxZ + 0.5]}
          collisionGroups={NOT_CAMERA_BLOCKING}
        />
        <CuboidCollider
          args={[0.5, 3, d / 2 + 2]}
          position={[bounds.minX - 0.5, 3, cz]}
          collisionGroups={NOT_CAMERA_BLOCKING}
        />
        <CuboidCollider
          args={[0.5, 3, d / 2 + 2]}
          position={[bounds.maxX + 0.5, 3, cz]}
          collisionGroups={NOT_CAMERA_BLOCKING}
        />
      </RigidBody>
    </group>
  );
});
