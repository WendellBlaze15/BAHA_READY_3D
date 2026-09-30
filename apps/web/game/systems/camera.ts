/**
 * Third-person chase camera: auto-follow behind the character + manual 360° orbit, pitch and
 * zoom. Pure math (unit-tested); the player controller drives it from useFrame with refs, so
 * the camera never causes React renders.
 *
 * Coordinates: the camera sits at target + (sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))
 * · distance. A character facing yaw `f` moves along (sin f, cos f), so "behind" is yaw = f + π.
 */
import { cameraConfigSchema, type CameraConfig } from '@baha/shared/level-config';

const cfgCache = new WeakMap<object, CameraConfig>();
const DEFAULTS = cameraConfigSchema.parse({});
/** Parsed camera config with defaults, cached per config object (safe to call every frame). */
export function cameraConfigOf(raw: unknown): CameraConfig {
  if (!raw || typeof raw !== 'object') return DEFAULTS;
  let c = cfgCache.get(raw);
  if (!c) {
    const parsed = cameraConfigSchema.safeParse(raw);
    c = parsed.success ? parsed.data : DEFAULTS;
    cfgCache.set(raw, c);
  }
  return c;
}

export type CamPrefs = {
  /** Auto-follow behind the character (default on). */
  autoFollow: boolean;
  /** Orbit/pitch sensitivity multiplier (0.25–3). */
  sensitivity: number;
  invertY: boolean;
  /** Auto-follow speed multiplier (0.25–3). */
  followSpeed: number;
  reducedMotion: boolean;
};

export const DEFAULT_CAM_PREFS: CamPrefs = {
  autoFollow: true,
  sensitivity: 1,
  invertY: false,
  followSpeed: 1,
  reducedMotion: false,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Reads the camera preferences stored in user_settings.controls (tolerates missing keys). */
export function readCamPrefs(controls: unknown, reducedMotion = false): CamPrefs {
  const c = (controls ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    autoFollow: typeof c.cameraAutoFollow === 'boolean' ? c.cameraAutoFollow : true,
    sensitivity: clamp(num(c.cameraSensitivity, 1), 0.25, 3),
    // The existing "Invert camera" setting now inverts vertical orbit.
    invertY: c.invertCamera === true,
    followSpeed: clamp(num(c.cameraFollowSpeed, 1), 0.25, 3),
    reducedMotion,
  };
}

export type CamState = {
  yaw: number;
  pitch: number;
  distance: number;
  /** Seconds since the last manual orbit input. */
  sinceManual: number;
};

export type CamInput = {
  /** Manual orbit deltas (pixels from drag/swipe, or stick units ×10). */
  lookX: number;
  lookY: number;
  /** Zoom delta (wheel pixels / pinch units; + = zoom out). */
  zoom: number;
  /** Character is moving under player control. */
  moving: boolean;
  /**
   * How much the movement input points "forward" (0..1). Auto-follow is weighted by it, so
   * strafing or walking toward the camera never swings the camera around in circles.
   */
  forward: number;
  /** Direction the character faces (radians). */
  facing: number;
};

export const wrapAngle = (a: number) => {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
};

/** Frame-rate independent exponential approach along the shortest arc. */
export function dampAngle(from: number, to: number, rate: number, dt: number) {
  const diff = wrapAngle(to - from);
  return from + diff * (1 - Math.exp(-rate * dt));
}

const ORBIT_RAD_PER_PX = 0.006;
const PITCH_RAD_PER_PX = 0.004;
const ZOOM_PER_UNIT = 0.0015;

export function initialCamState(indoor: boolean, cfg: CameraConfig, facing = 0): CamState {
  return {
    yaw: wrapAngle(facing + Math.PI),
    pitch: indoor ? cfg.indoorPitch : cfg.outdoorPitch,
    distance: indoor ? cfg.indoorDistance : cfg.outdoorDistance,
    sinceManual: Number.POSITIVE_INFINITY,
  };
}

export function stepCamera(
  s: CamState,
  input: CamInput,
  dt: number,
  cfg: CameraConfig,
  prefs: CamPrefs,
): CamState {
  let { yaw, pitch, distance, sinceManual } = s;
  const manual = Math.abs(input.lookX) + Math.abs(input.lookY) > 1e-6;

  if (manual) {
    yaw -= input.lookX * ORBIT_RAD_PER_PX * prefs.sensitivity;
    pitch += input.lookY * PITCH_RAD_PER_PX * prefs.sensitivity * (prefs.invertY ? -1 : 1);
    sinceManual = 0;
  } else {
    sinceManual += dt;
  }
  pitch = clamp(pitch, cfg.minPitch, cfg.maxPitch);

  if (input.zoom !== 0) {
    distance = clamp(
      distance * Math.exp(input.zoom * ZOOM_PER_UNIT),
      cfg.minDistance,
      cfg.maxDistance,
    );
  }

  // Auto-follow: only while moving, only after the manual-input grace period. Standing still
  // keeps whatever angle the player chose.
  if (
    prefs.autoFollow &&
    input.moving &&
    !manual &&
    sinceManual >= cfg.followDelaySec &&
    input.forward > 0
  ) {
    const soften = prefs.reducedMotion ? 0.5 : 1;
    const rate = cfg.followRate * prefs.followSpeed * soften * input.forward * input.forward;
    yaw = dampAngle(yaw, input.facing + Math.PI, rate, dt);
  }

  return { yaw: wrapAngle(yaw), pitch, distance, sinceManual };
}

/** Unit vector from the look target toward the camera. */
export function cameraDirection(yaw: number, pitch: number) {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}

/**
 * Distance the camera may sit at, given a wall hit along the look ray (null = no hit).
 * Pulls in in front of the wall; never closer than collisionMinDistance.
 */
export function collisionDistance(desired: number, hitAt: number | null, cfg: CameraConfig) {
  if (hitAt === null || hitAt >= desired) return desired;
  return Math.max(cfg.collisionMinDistance, hitAt - cfg.collisionPadding);
}

/** Camera smoothing factor per frame: softer and slower with reduced motion. */
export function followLerp(dt: number, reducedMotion: boolean) {
  return 1 - Math.pow(reducedMotion ? 0.05 : 0.001, dt);
}
