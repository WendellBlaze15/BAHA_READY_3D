'use client';

import type { NpcInstance } from '@baha/shared/game';

export type NpcRuntime = {
  id: string;
  key: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  speedMul: number;
  state: 'waiting' | 'following' | 'rescued';
};

/** Mutable per-frame NPC state (read by visuals in useFrame, written by the game loop). */
export const npcRuntime = new Map<string, NpcRuntime>();

export function resetNpcs(
  npcs: NpcInstance[],
  needs: Record<string, { speedMultiplier?: number }>,
) {
  npcRuntime.clear();
  for (const n of npcs) {
    npcRuntime.set(n.id, {
      id: n.id,
      key: n.key,
      x: n.pos.x,
      z: n.pos.z,
      yaw: 0,
      speed: 0,
      speedMul: needs[n.key]?.speedMultiplier ?? 1,
      state: 'waiting',
    });
  }
}

/** Seek (follow the player, keeping a gap by order) + separation from other followers. */
export function stepFollowers(
  player: { x: number; z: number },
  followerIds: string[],
  baseSpeed: number,
  dt: number,
) {
  followerIds.forEach((id, idx) => {
    const n = npcRuntime.get(id);
    if (!n) return;
    const gap = 1.3 + idx * 0.9;
    const dx = player.x - n.x;
    const dz = player.z - n.z;
    const d = Math.hypot(dx, dz);
    let vx = 0;
    let vz = 0;
    if (d > gap) {
      const s = Math.min(
        baseSpeed * n.speedMul * (d > 6 ? 1.25 : 1),
        (d - gap) / Math.max(dt, 1e-3),
      );
      vx = (dx / d) * s;
      vz = (dz / d) * s;
    }
    for (const other of followerIds) {
      if (other === id) continue;
      const o = npcRuntime.get(other);
      if (!o) continue;
      const sx = n.x - o.x;
      const sz = n.z - o.z;
      const sd = Math.hypot(sx, sz);
      if (sd > 0.001 && sd < 0.9) {
        vx += (sx / sd) * 1.5;
        vz += (sz / sd) * 1.5;
      }
    }
    n.x += vx * dt;
    n.z += vz * dt;
    n.speed = Math.hypot(vx, vz);
    if (n.speed > 0.1) n.yaw = Math.atan2(vx, vz);
  });
}
