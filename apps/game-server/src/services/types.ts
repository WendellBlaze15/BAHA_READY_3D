import type { SurvivalConfig } from '@baha/shared/survival';

/**
 * Everything the rooms need from the outside world. Production wires Supabase + Upstash
 * (services/live.ts); tests inject in-memory fakes (services/memory.ts).
 */
export interface Identity {
  userId: string;
  /** JWT exp (seconds) — the room re-checks eligibility when it lapses. */
  exp: number;
}

export interface PlayerProfile {
  userId: string;
  username: string;
  avatar: Record<string, unknown>;
}

export type Eligibility =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; reason: 'not_eligible' | 'survival_disabled' | 'chat_restricted' };

export interface CodeStore {
  /** Reserves a free code for a room; returns null when the space is exhausted. */
  reserve(roomId: string, ttlSec: number): Promise<string | null>;
  resolve(code: string): Promise<string | null>;
  refresh(code: string, ttlSec: number): Promise<void>;
  release(code: string): Promise<void>;
}

export type LimitAction = 'room_create' | 'room_join' | 'code_lookup' | 'chat_send';

export interface RateLimiter {
  /** true = allowed. */
  check(action: LimitAction, key: string): Promise<boolean>;
}

export interface Services {
  verifyToken(token: string): Promise<Identity | null>;
  checkEligibility(userId: string): Promise<Eligibility>;
  currentConfig(): Promise<{ id: string; version: number; config: SurvivalConfig }>;
  codes: CodeStore;
  limiter: RateLimiter;
}
