'use client';

/**
 * Procedural audio via WebAudio (Section 9.9).
 * DECISION: sounds are synthesized (filtered noise, oscillators) instead of loading audio
 * files — zero download, works offline, and each layer's intensity is a live parameter.
 * Layers: rain (intensity-linked), wind, thunder, water slosh (depth-linked), siren, UI.
 */
type Volumes = { master: number; music: number; sfx: number; voice: number };

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private waterGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private started = false;
  private vol: Volumes = { master: 0.8, music: 0.6, sfx: 0.8, voice: 0.9 };

  setVolumes(v: Partial<Volumes>) {
    this.vol = { ...this.vol, ...v };
    if (this.master) this.master.gain.value = this.vol.master;
    if (this.sfx) this.sfx.gain.value = this.vol.sfx;
  }

  /** Must be called from a user gesture (autoplay policy). */
  start() {
    if (this.started || typeof window === 'undefined') return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol.master;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.vol.sfx;
    this.sfx.connect(this.master);

    // 2s of white noise, looped by every noise-based layer.
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.rainGain = this.loopNoise({ type: 'highpass', freq: 1200, q: 0.5 }, 0);
    this.windGain = this.loopNoise({ type: 'lowpass', freq: 400, q: 1 }, 0);
    this.waterGain = this.loopNoise({ type: 'bandpass', freq: 500, q: 0.8 }, 0);
    this.started = true;
  }

  private loopNoise(f: { type: BiquadFilterType; freq: number; q: number }, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = f.type;
    filter.frequency.value = f.freq;
    filter.Q.value = f.q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.sfx!);
    src.start();
    return g;
  }

  private ramp(g: GainNode | null, v: number) {
    if (!g || !this.ctx) return;
    g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  setRain(intensity: number) {
    this.ramp(this.rainGain, 0.05 + intensity * 0.35);
    this.ramp(this.windGain, intensity * 0.25);
  }

  /** Water sloshing scales with depth and movement speed. */
  setWater(depth: number, moving: number) {
    this.ramp(this.waterGain, Math.min(0.5, depth * 0.4) * Math.min(1, moving));
  }

  thunder(distance = 0.5) {
    if (!this.ctx || !this.noise) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + distance * 1.5; // sound travels slower than light
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9 * (1 - distance * 0.5), t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 3);
    src.connect(f).connect(g).connect(this.sfx!);
    src.start(t0);
    src.stop(t0 + 3.2);
  }

  /** Rising/falling siren at phase changes. */
  siren(seconds = 3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const g = ctx.createGain();
    g.gain.value = 0.06;
    const t = ctx.currentTime;
    for (let i = 0; i < seconds; i++) {
      osc.frequency.setValueAtTime(600, t + i);
      osc.frequency.linearRampToValueAtTime(1100, t + i + 0.5);
      osc.frequency.linearRampToValueAtTime(600, t + i + 1);
    }
    g.gain.setTargetAtTime(0, t + seconds - 0.3, 0.2);
    osc.connect(g).connect(this.sfx!);
    osc.start();
    osc.stop(t + seconds);
  }

  blip(kind: 'pack' | 'unpack' | 'task' | 'error' | 'rescue' | 'hit' | 'win' = 'pack') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const notes: Record<string, number[]> = {
      pack: [660, 880],
      unpack: [660, 440],
      task: [523, 659, 784],
      error: [220, 180],
      rescue: [523, 784, 1047],
      hit: [150, 90],
      win: [523, 659, 784, 1047],
    };
    const seq = notes[kind] ?? [660];
    seq.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = kind === 'hit' || kind === 'error' ? 'square' : 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(this.sfx!);
      o.start(t);
      o.stop(t + 0.18);
    });
  }

  suspend() {
    void this.ctx?.suspend();
  }
  resume() {
    void this.ctx?.resume();
  }
  stop() {
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

export const audio = new AudioManager();

/** Haptics: Capacitor when native, navigator.vibrate on the web. */
export function haptic(pattern: number | number[] = 40) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported
  }
}
