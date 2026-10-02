import { describe, expect, it } from 'vitest';
import { BARANGAY_1 } from '@baha/shared/survival';
import { nearestTarget, type TargetWorld } from './interaction';

const base = (over: Partial<TargetWorld> = {}): TargetWorld => ({
  map: BARANGAY_1,
  me: { x: -60, z: -40, userId: 'me' },
  lootOpened: new Set(),
  crates: [],
  drops: [],
  npcs: [],
  downed: [],
  shelterBuilt: false,
  night: false,
  finalDay: false,
  ...over,
});

describe('nearestTarget', () => {
  it('finds nothing far from everything', () => {
    expect(nearestTarget(base({ me: { x: -100, z: 60, userId: 'me' } }))).toBeNull();
  });

  it('prefers helping a downed teammate', () => {
    const lp = BARANGAY_1.lootPoints[0]!;
    const t = nearestTarget(
      base({
        me: { x: lp.x, z: lp.z, userId: 'me' },
        downed: [{ userId: 'b', name: 'Ana', x: lp.x + 1, z: lp.z }],
      }),
    );
    expect(t).toMatchObject({ kind: 'revive', userId: 'b' });
  });

  it('picks the closest unopened loot and skips opened ones', () => {
    const lp = BARANGAY_1.lootPoints[0]!;
    expect(nearestTarget(base({ me: { x: lp.x, z: lp.z, userId: 'me' } }))).toMatchObject({
      kind: 'loot',
      id: lp.id,
    });
    const t = nearestTarget(
      base({ me: { x: lp.x, z: lp.z, userId: 'me' }, lootOpened: new Set([lp.id]) }),
    );
    expect(t?.kind === 'loot' && t.id === lp.id).toBe(false);
  });

  it('offers the boat at the dock and sleep in a sheltered camp at night', () => {
    const dock = BARANGAY_1.boatDock;
    expect(nearestTarget(base({ me: { x: dock.x, z: dock.z, userId: 'me' } }))).toMatchObject({
      kind: 'boat',
    });
    expect(
      nearestTarget(base({ me: { x: 0, z: -6, userId: 'me' }, night: true, shelterBuilt: true }))
        ?.kind,
    ).toBe('sleep');
  });
});
