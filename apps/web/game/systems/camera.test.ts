import { describe, expect, it } from 'vitest';
import { DEFAULT_CAMERA } from '@baha/shared/level-config';
import {
  DEFAULT_CAM_PREFS,
  collisionDistance,
  initialCamState,
  readCamPrefs,
  stepCamera,
  wrapAngle,
  type CamInput,
} from './camera';

const cfg = { ...DEFAULT_CAMERA };
const still: CamInput = { lookX: 0, lookY: 0, zoom: 0, moving: false, forward: 0, facing: 0 };
/** Runs `seconds` of frames at 60 fps. */
function simulate(
  s: ReturnType<typeof initialCamState>,
  input: Partial<CamInput>,
  seconds: number,
  prefs = DEFAULT_CAM_PREFS,
) {
  for (let i = 0; i < Math.round(seconds * 60); i++)
    s = stepCamera(s, { ...still, ...input }, 1 / 60, cfg, prefs);
  return s;
}
const behind = (facing: number) => wrapAngle(facing + Math.PI);
const angleGap = (a: number, b: number) => Math.abs(wrapAngle(a - b));

describe('auto-follow', () => {
  it('swings smoothly behind the character when it turns while moving', () => {
    let s = initialCamState(false, cfg, 0);
    const facing = Math.PI / 2; // character turned right
    const oneFrame = stepCamera(
      s,
      { ...still, moving: true, forward: 1, facing },
      1 / 60,
      cfg,
      DEFAULT_CAM_PREFS,
    );
    // Damped: a single frame moves only a little (no snapping).
    expect(angleGap(oneFrame.yaw, s.yaw)).toBeLessThan(0.1);
    s = simulate(s, { moving: true, forward: 1, facing }, 2);
    expect(angleGap(s.yaw, behind(facing))).toBeLessThan(0.05);
  });

  it('does not rotate while the character stands still (keeps the chosen angle)', () => {
    const s0 = { ...initialCamState(false, cfg, 0), yaw: 1.2 };
    const s = simulate(s0, { moving: false, facing: 0 }, 5);
    expect(s.yaw).toBeCloseTo(1.2, 6);
  });

  it('does not circle when strafing or walking toward the camera', () => {
    const s0 = initialCamState(false, cfg, 0);
    expect(simulate(s0, { moving: true, forward: 0, facing: Math.PI / 2 }, 3).yaw).toBeCloseTo(
      s0.yaw,
      6,
    );
  });

  it('can be switched off in settings', () => {
    const s0 = initialCamState(false, cfg, 0);
    const s = simulate(s0, { moving: true, forward: 1, facing: 2 }, 3, {
      ...DEFAULT_CAM_PREFS,
      autoFollow: false,
    });
    expect(s.yaw).toBeCloseTo(s0.yaw, 6);
  });

  it('reduced motion follows more gently', () => {
    const s0 = initialCamState(false, cfg, 0);
    const input = { moving: true, forward: 1, facing: Math.PI / 2 };
    const normal = simulate(s0, input, 0.3);
    const soft = simulate(s0, input, 0.3, { ...DEFAULT_CAM_PREFS, reducedMotion: true });
    expect(angleGap(soft.yaw, s0.yaw)).toBeLessThan(angleGap(normal.yaw, s0.yaw));
  });
});

describe('manual orbit', () => {
  it('orbits a full 360° and pauses auto-follow', () => {
    let s = initialCamState(false, cfg, 0);
    const start = s.yaw;
    // Drag ~1047 px ≈ 2π at sensitivity 1 → back to the start angle.
    for (let i = 0; i < 60; i++)
      s = stepCamera(
        s,
        { ...still, lookX: (Math.PI * 2) / 0.006 / 60, moving: true, forward: 1 },
        1 / 60,
        cfg,
        DEFAULT_CAM_PREFS,
      );
    expect(angleGap(s.yaw, start)).toBeLessThan(0.02);
    expect(s.sinceManual).toBe(0);
  });

  it('resumes auto-follow ~1.5 s after manual input stops, only while moving', () => {
    let s = initialCamState(false, cfg, 0);
    s = stepCamera(s, { ...still, lookX: 200 }, 1 / 60, cfg, DEFAULT_CAM_PREFS);
    const afterDrag = s.yaw;
    const moving = { moving: true, forward: 1, facing: 0 };
    s = simulate(s, moving, 1.2); // inside the grace period
    expect(s.yaw).toBeCloseTo(afterDrag, 6);
    s = simulate(s, moving, 2); // past it: returns behind the character
    expect(angleGap(s.yaw, behind(0))).toBeLessThan(0.1);
  });

  it('clamps pitch within safe limits and honours invert-Y', () => {
    let s = initialCamState(false, cfg, 0);
    s = simulate(s, { lookY: 500 }, 0.5);
    expect(s.pitch).toBe(cfg.maxPitch);
    s = simulate(s, { lookY: -500 }, 0.5);
    expect(s.pitch).toBe(cfg.minPitch);
    const inv = stepCamera(
      { ...initialCamState(false, cfg, 0) },
      { ...still, lookY: 50 },
      1 / 60,
      cfg,
      { ...DEFAULT_CAM_PREFS, invertY: true },
    );
    expect(inv.pitch).toBeLessThan(cfg.outdoorPitch);
  });

  it('sensitivity scales the orbit', () => {
    const s0 = initialCamState(false, cfg, 0);
    const slow = stepCamera(s0, { ...still, lookX: 100 }, 1 / 60, cfg, {
      ...DEFAULT_CAM_PREFS,
      sensitivity: 0.5,
    });
    const fast = stepCamera(s0, { ...still, lookX: 100 }, 1 / 60, cfg, {
      ...DEFAULT_CAM_PREFS,
      sensitivity: 2,
    });
    expect(angleGap(fast.yaw, s0.yaw)).toBeCloseTo(4 * angleGap(slow.yaw, s0.yaw), 5);
  });
});

describe('zoom & collision', () => {
  it('zooms within min/max distance', () => {
    let s = initialCamState(false, cfg, 0);
    s = simulate(s, { zoom: 400 }, 1);
    expect(s.distance).toBe(cfg.maxDistance);
    s = simulate(s, { zoom: -400 }, 1);
    expect(s.distance).toBe(cfg.minDistance);
  });

  it('pulls the camera in front of a wall and never inside it', () => {
    expect(collisionDistance(10, null, cfg)).toBe(10);
    expect(collisionDistance(10, 12, cfg)).toBe(10);
    expect(collisionDistance(10, 4, cfg)).toBeCloseTo(3.7, 6);
    expect(collisionDistance(10, 0.5, cfg)).toBe(cfg.collisionMinDistance);
  });
});

describe('preferences', () => {
  it('reads user_settings.controls with safe defaults', () => {
    expect(readCamPrefs(undefined)).toEqual(DEFAULT_CAM_PREFS);
    expect(
      readCamPrefs({
        cameraAutoFollow: false,
        cameraSensitivity: 9,
        invertCamera: true,
        cameraFollowSpeed: 0.5,
      }),
    ).toEqual({
      autoFollow: false,
      sensitivity: 3,
      invertY: true,
      followSpeed: 0.5,
      reducedMotion: false,
    });
  });
});
