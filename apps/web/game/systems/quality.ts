import type { Quality } from '../store/game-store';

export const isMobileDevice = () =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/**
 * Auto quality from device hints (Section 9.7); PerformanceMonitor refines it live.
 * Kept free of three.js imports so the game route's initial chunk stays small.
 */
export function detectQuality(pref: string | undefined): Quality {
  if (pref === 'low' || pref === 'medium' || pref === 'high') return pref;
  if (typeof navigator === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores <= 4 || mem <= 3) return 'low';
  if (isMobileDevice() || cores <= 6) return 'medium';
  return 'high';
}
