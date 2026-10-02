import type { ChatWordlist, SurvivalConfig } from '@baha/shared/survival';

/**
 * Everything the rooms need from the outside world. Production wires Supabase + Upstash
 * (services/live.ts); tests inject in-memory fakes (services/memory.ts).
 */
export interface Identity {
  userId: string;
  /** JWT exp (seconds) — the room re-checks eligibility when it lapses. */
  exp: number;
}

export type ChatMode = 'full' | 'quick_only' | 'off';

export interface PlayerProfile {
  userId: string;
  username: string;
  avatar: Record<string, unknown>;
  /** Active admin chat restriction (text chat off; quick chat still allowed). */
  chatRestricted: boolean;
  /** Player's own setting (Settings → Survival). */
  chatMode: ChatMode;
}

export type Eligibility =
  | { ok: true; profile: PlayerProfile }
  | {
      ok: false;
      /** role_changed: became staff (may finish the current session, Section 2.2). */
      reason: 'not_eligible' | 'survival_disabled' | 'role_changed';
    };

export interface CodeStore {
  /** Reserves a free code for a room; returns null when the space is exhausted. */
  reserve(roomId: string, ttlSec: number): Promise<string | null>;
  resolve(code: string): Promise<string | null>;
  refresh(code: string, ttlSec: number): Promise<void>;
  release(code: string): Promise<void>;
}

/** runId → live roomId (one live session per run, across instances). */
export interface LiveRuns {
  set(runId: string, roomId: string, ttlSec: number): Promise<void>;
  get(runId: string): Promise<string | null>;
  del(runId: string, roomId: string): Promise<void>;
}

export type LimitAction =
  'room_create' | 'room_join' | 'code_lookup' | 'report' | 'mute' | 'resume';

export interface RateLimiter {
  /** true = allowed. */
  check(action: LimitAction, key: string): Promise<boolean>;
}

export interface NewRun {
  hostId: string;
  mode: 'solo' | 'coop';
  difficulty: string;
  configVersionId: string;
  seed: number;
}

export interface ChatRow {
  runId: string;
  sessionId: string | null;
  senderId: string;
  bodyOriginal: string;
  bodyDelivered: string | null;
  status: 'delivered' | 'masked' | 'rejected';
  filterHits: string[];
}

export interface LearningRow {
  runId: string;
  userId: string | null;
  day: number;
  eventKey: string;
  isPositive: boolean;
}

export interface ReportRow {
  runId: string | null;
  reporterId: string;
  reportedId: string;
  reason: string;
  priority: 'normal' | 'high';
  messageId: number | null;
  evidence: Record<string, unknown>;
}

/** Server-only writes (service role). Snapshots/results arrive in Phase 7. */
export interface Persistence {
  createRun(run: NewRun): Promise<string>;
  setRunStatus(runId: string, status: string): Promise<void>;
  setMembers(runId: string, members: { userId: string; role: string }[]): Promise<void>;
  createSession(runId: string, roomId: string): Promise<string>;
  endSession(sessionId: string, reason: string): Promise<void>;
  insertChat(row: ChatRow): Promise<number>;
  insertLearning(rows: LearningRow[]): Promise<void>;
  insertChatFlag(userId: string, runId: string | null, reason: string): Promise<void>;
  createReport(row: ReportRow): Promise<string>;
  /** Mutes and blocks where any of `userIds` is involved. */
  loadRelations(
    userIds: string[],
  ): Promise<{ mutes: [string, string][]; blocks: [string, string][] }>;
  setMute(muterId: string, mutedId: string, on: boolean): Promise<void>;
  /** survival_chat_enabled (cached). */
  chatEnabled(): Promise<boolean>;
  /** survival_enabled kill switch (cached). */
  survivalEnabled(): Promise<boolean>;
  /** Admin-managed filter additions (cached). */
  chatWordlist(): Promise<ChatWordlist>;

  // ── Phase 7: runs, snapshots, results ──
  loadRun(runId: string): Promise<RunRow | null>;
  /** The run's pinned config version (never "current" — a run keeps its rules). */
  configById(id: string): Promise<{ id: string; version: number; config: SurvivalConfig }>;
  saveSnapshot(runId: string, day: number, minute: number, state: unknown): Promise<number>;
  latestSnapshot(runId: string): Promise<unknown | null>;
  updateRunProgress(
    runId: string,
    p: { currentDay: number; boatStage: number; flags: string[] },
  ): Promise<void>;
  finishRun(runId: string, payload: Record<string, unknown>): Promise<FinishResult>;
  notifyResumed(runId: string, byUserId: string, day: number, code: string): Promise<void>;
  /** Runs (lobby/active) this player is an active member of. */
  activeRunCount(userId: string): Promise<number>;
  setMemberStatus(runId: string, userId: string, status: 'active' | 'left'): Promise<void>;
  setHost(runId: string, userId: string): Promise<void>;
  endOpenSessions(runId: string, reason: string): Promise<void>;
}

export interface RunRow {
  id: string;
  hostId: string;
  mode: 'solo' | 'coop';
  difficulty: 'easy' | 'normal' | 'hard';
  configVersionId: string;
  seed: number;
  status: string;
  currentDay: number;
  members: { userId: string; role: string; status: string }[];
}

export interface FinishResult {
  rewards: Record<string, string[]>;
  achievements: Record<string, string[]>;
}

/** Cross-room auto-mute state (escalation window 24 h). */
export interface ChatModeration {
  mutedUntil(userId: string): Promise<number>;
  /** Applies the next escalation step; returns the mute end (ms) and the offense count in 24 h. */
  applyAutoMute(
    userId: string,
    minutesByLevel: number[],
  ): Promise<{ until: number; level: number }>;
}

export interface Services {
  verifyToken(token: string): Promise<Identity | null>;
  checkEligibility(userId: string): Promise<Eligibility>;
  currentConfig(): Promise<{ id: string; version: number; config: SurvivalConfig }>;
  codes: CodeStore;
  limiter: RateLimiter;
  db: Persistence;
  moderation: ChatModeration;
  liveRuns: LiveRuns;
}
