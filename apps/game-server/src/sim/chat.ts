import type { SurvivalConfig } from '@baha/shared/survival';

export type ChatPrecheck = null | 'rate_limited' | 'duplicate';

interface UserChatState {
  lastAt: number;
  minute: number[];
  recent: string[];
  hits: number[];
}

export interface ChatLine {
  id: number;
  senderId: string;
  text: string;
  status: 'delivered' | 'masked';
  at: number;
}

/**
 * Per-room text-chat rules (Section 17.1) that need memory: 1 message / 1.5 s, 20 / min,
 * the same text N times in a row, and "3 rejected or heavily masked messages in 5 minutes"
 * → auto-mute. Times are wall-clock ms (injected for tests). The 24 h escalation lives in Redis.
 */
export class ChatGuard {
  private users = new Map<string, UserChatState>();
  /** Delivered lines of this session (for history on join, report context). */
  readonly history: ChatLine[] = [];

  constructor(private cfg: SurvivalConfig['chat']) {}

  private state(uid: string) {
    let s = this.users.get(uid);
    if (!s) {
      s = { lastAt: -Infinity, minute: [], recent: [], hits: [] };
      this.users.set(uid, s);
    }
    return s;
  }

  /** Rate + duplicate checks BEFORE filtering. Records the attempt when allowed. */
  precheck(uid: string, text: string, now: number): ChatPrecheck {
    const s = this.state(uid);
    s.minute = s.minute.filter((t) => now - t < 60_000);
    if (now - s.lastAt < this.cfg.minIntervalMs || s.minute.length >= this.cfg.perMinute)
      return 'rate_limited';
    const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const dupes = this.cfg.duplicateLimit - 1;
    if (s.recent.length >= dupes && s.recent.slice(-dupes).every((r) => r === norm))
      return 'duplicate';
    s.lastAt = now;
    s.minute.push(now);
    s.recent = [...s.recent.slice(-(this.cfg.duplicateLimit - 1)), norm];
    return null;
  }

  /** Counts a moderation hit; true when the sender has reached the auto-mute threshold. */
  recordHit(uid: string, now: number): boolean {
    const s = this.state(uid);
    const windowMs = this.cfg.autoMuteWindowMin * 60_000;
    s.hits = s.hits.filter((t) => now - t < windowMs);
    s.hits.push(now);
    if (s.hits.length >= this.cfg.autoMuteHits) {
      s.hits = [];
      return true;
    }
    return false;
  }

  remember(line: ChatLine) {
    this.history.push(line);
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
  }

  /** Reported message plus up to `n` lines of context on each side (evidence). */
  context(messageId: number, n = 10) {
    const i = this.history.findIndex((l) => l.id === messageId);
    if (i < 0) return null;
    return this.history.slice(Math.max(0, i - n), i + n + 1);
  }
}

/** "Heavily masked": several words hidden in one message counts toward auto-mute. */
export const HEAVY_MASK_WORDS = 2;
