'use client';

import Dexie, { type Table } from 'dexie';
import type { ClientSummary, GameEvent } from '@baha/shared/game';

export type PendingSubmission = {
  idempotency_key: string;
  attempt_id: string;
  attempt_token: string;
  events: GameEvent[];
  client_summary: ClientSummary;
  level_id: number;
  created_at: number;
  tries: number;
  next_try_at: number;
};

export type GuestAttempt = {
  id?: number;
  level_id: number;
  seed: string;
  events: GameEvent[];
  client_summary: ClientSummary;
  created_at: number;
};

export type GuestProgress = { level_id: number; best_score: number; best_stars: number };

/** Offline storage (Section 15.4): queued submissions, guest play, content snapshot. */
class BahaDb extends Dexie {
  pending_submissions!: Table<PendingSubmission, string>;
  guest_attempts!: Table<GuestAttempt, number>;
  guest_progress!: Table<GuestProgress, number>;
  content_snapshot!: Table<{ key: string; value: unknown; saved_at: number }, string>;

  constructor() {
    super('baha-ready');
    this.version(1).stores({
      pending_submissions: '&idempotency_key, next_try_at',
      guest_attempts: '++id, level_id, created_at',
      guest_progress: '&level_id',
      content_snapshot: '&key',
    });
  }
}

let db: BahaDb | null = null;
export function getDb() {
  if (typeof indexedDB === 'undefined') return null;
  db ??= new BahaDb();
  return db;
}
