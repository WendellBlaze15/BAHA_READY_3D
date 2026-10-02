'use client';

/**
 * Per-frame side channel between server messages and the 3D scene (no React state):
 * position corrections for the local player and one-shot animation cues for avatars.
 */
export const bus = {
  correction: null as null | { x: number; y: number; z: number; reason: string },
  swings: new Map<string, number>(),
  emotes: new Map<string, { id: string; at: number }>(),
  /** Chat bubbles above avatars (4 s, within 30 m). */
  bubbles: new Map<string, { text: string; at: number }>(),
  reset() {
    this.correction = null;
    this.swings.clear();
    this.emotes.clear();
    this.bubbles.clear();
  },
};
