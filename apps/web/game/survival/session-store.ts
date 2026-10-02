'use client';

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { Room } from '@colyseus/sdk';

export type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';
export type Panel = 'bag' | 'craft' | 'storage' | 'map' | 'boat' | 'camp' | 'menu' | null;

export interface ChatLine {
  id: number | string;
  senderId: string | null;
  text?: string;
  /** System line: i18n key under survival.* + params. */
  key?: string;
  params?: Record<string, string | number>;
  status?: 'delivered' | 'masked';
  at: number;
  quick?: number;
}

export interface Toast {
  id: number;
  tone: 'info' | 'good' | 'warn' | 'danger';
  key: string;
  params?: Record<string, string | number>;
  at: number;
}

export interface GiveOffer {
  offerId: string;
  fromUserId: string;
  item: string;
  qty: number;
}

export interface Ping {
  userId: string;
  type: 'item' | 'danger' | 'go' | 'help';
  x: number;
  y: number;
  z: number;
  until: number;
}

interface SessionState {
  room: Room | null;
  roomId: string | null;
  status: Status;
  errorKey: string | null;
  myId: string | null;
  chat: ChatLine[];
  chatOpen: boolean;
  unread: number;
  chatMutedUntil: number;
  muted: Set<string>;
  toasts: Toast[];
  offers: GiveOffer[];
  pings: Ping[];
  panel: Panel;
  results: Record<string, unknown> | null;
  rewards: { rewards: string[]; achievements: string[] } | null;
  /** Bumped by the throttled state listener: UI selectors re-read room.state. */
  version: number;
  set: (p: Partial<SessionState>) => void;
  toast: (t: Omit<Toast, 'id' | 'at'>) => void;
  addChat: (l: ChatLine) => void;
  reset: () => void;
}

let toastSeq = 0;
const MAX_CHAT = 100;

export const useSession = create<SessionState>((set, get) => ({
  room: null,
  roomId: null,
  status: 'idle',
  errorKey: null,
  myId: null,
  chat: [],
  chatOpen: false,
  unread: 0,
  chatMutedUntil: 0,
  muted: new Set(),
  toasts: [],
  offers: [],
  pings: [],
  panel: null,
  results: null,
  rewards: null,
  version: 0,
  set: (p) => set(p),
  toast: (t) => {
    const toast = { ...t, id: ++toastSeq, at: Date.now() };
    set({ toasts: [...get().toasts.slice(-3), toast] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== toast.id) }), 4500);
  },
  addChat: (l) =>
    set((s) => ({
      chat: [...s.chat, l].slice(-MAX_CHAT),
      unread: s.chatOpen || l.senderId === s.myId ? s.unread : s.unread + 1,
    })),
  reset: () =>
    set({
      room: null,
      roomId: null,
      status: 'idle',
      errorKey: null,
      chat: [],
      unread: 0,
      toasts: [],
      offers: [],
      pings: [],
      panel: null,
      results: null,
      rewards: null,
      chatOpen: false,
    }),
}));

/** Live synced state (read-only). Typed loosely: the schema lives on the server. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SyncState = any;

/**
 * Re-renders at most `hz` times per second when the synced state changes and returns a
 * selector result. The 3D scene reads room.state directly in useFrame instead.
 */
export function useRoomState<T>(select: (s: SyncState) => T, hz = 6): T | undefined {
  const room = useSession((s) => s.room);
  const [, force] = useState(0);
  useEffect(() => {
    if (!room) return;
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      const now = performance.now();
      const wait = 1000 / hz - (now - last);
      if (wait <= 0) {
        last = now;
        force((v) => v + 1);
      } else if (!timer)
        timer = setTimeout(() => {
          timer = null;
          last = performance.now();
          force((v) => v + 1);
        }, wait);
    };
    room.onStateChange(bump);
    bump();
    return () => {
      if (timer) clearTimeout(timer);
      room.onStateChange.remove(bump);
    };
  }, [room, hz]);
  if (!room?.state) return undefined;
  try {
    return select(room.state);
  } catch {
    return undefined;
  }
}

/** Helpers for MapSchema/ArraySchema on the client. */
export function mapValues<T>(m: { forEach?: (cb: (v: T, k: string) => void) => void } | undefined) {
  const out: [string, T][] = [];
  m?.forEach?.((v, k) => out.push([k, v]));
  return out;
}

// E2E probe (Playwright sets window.__BAHA_E2E__ before load): exposes the session store.
if (typeof window !== 'undefined' && (window as unknown as { __BAHA_E2E__?: boolean }).__BAHA_E2E__)
  (window as unknown as { __survival?: typeof useSession }).__survival = useSession;
