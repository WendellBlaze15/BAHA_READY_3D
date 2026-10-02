'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Flag, MessageCircle, Send, VolumeX, Volume2 } from 'lucide-react';
import { QUICK_CHAT } from '@baha/shared/survival';
import { mapValues, useRoomState, useSession, type ChatLine } from '@/game/survival/session-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useSurvivalText } from './use-text';

const REPORT_REASONS = [
  'chat_harassment',
  'chat_language',
  'personal_info_request',
  'griefing',
  'afk',
  'offensive_name_avatar',
  'other',
] as const;

/**
 * Team chat (Section 17.1): text + quick chat. Everything is filtered and enforced on the
 * server; this UI renders plain text only (never HTML) and is an ARIA live region.
 */
export function ChatPanel({ overlay }: { overlay: boolean }) {
  const t = useTranslations('survival');
  const room = useSession((s) => s.room);
  const open = useSession((s) => s.chatOpen);
  const unread = useSession((s) => s.unread);
  const chat = useSession((s) => s.chat);
  const myId = useSession((s) => s.myId);
  const muted = useSession((s) => s.muted);
  const mutedUntil = useSession((s) => s.chatMutedUntil);
  const { text: say, quick } = useSurvivalText();
  const names = useRoomState((s) =>
    Object.fromEntries(
      mapValues<{ username: string; role: string }>(s.players).map(([k, p]) => [
        k,
        { name: p.username, role: p.role },
      ]),
    ),
  ) as Record<string, { name: string; role: string }> | undefined;
  const [draft, setDraft] = useState('');
  const seq = useRef(0);
  const list = useRef<HTMLOListElement>(null);
  const setOpen = (v: boolean) =>
    useSession.getState().set({ chatOpen: v, ...(v ? { unread: 0 } : {}) });

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, open]);

  // Desktop: Enter or T opens chat (game controls pause while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter' || e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!room) return null;
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    room.send('chat:send', {
      text: text.slice(0, 600),
      clientMsgId: `c${Date.now()}${++seq.current}`,
    });
    setDraft('');
  };
  const isMuted = mutedUntil > Date.now();

  const Line = ({ l }: { l: ChatLine }) => {
    if (!l.senderId)
      return <li className="text-signal-amber text-sm italic">{say(l.key ?? '', l.params)}</li>;
    if (muted.has(l.senderId)) return null;
    const who = names?.[l.senderId];
    const mine = l.senderId === myId;
    return (
      <li className="group flex min-w-0 items-start gap-2 text-sm">
        <span className="min-w-0 flex-1 break-words">
          <span className="font-semibold">{who?.name ?? '…'}</span>
          {who?.role && who.role !== 'solo' && (
            <span className="text-muted-foreground ml-1 text-xs">
              [{t(`role.${who.role}` as 'role.medic')}]
            </span>
          )}
          <span className="text-muted-foreground ml-1 text-xs">
            {new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="block whitespace-pre-wrap">
            {l.quick !== undefined ? `💬 ${quick(l.quick)}` : l.text}
          </span>
        </span>
        {!mine && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`${t('chat.report')} / ${t('chat.mute')}`}
              >
                <Flag aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  room.send(muted.has(l.senderId!) ? 'chat:unmute' : 'chat:mute', {
                    userId: l.senderId,
                  })
                }
              >
                {muted.has(l.senderId) ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                {muted.has(l.senderId) ? t('chat.unmute') : t('chat.mute')}
              </DropdownMenuItem>
              {typeof l.id === 'number' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('chat.report')}</DropdownMenuLabel>
                  {REPORT_REASONS.map((r) => (
                    <DropdownMenuItem
                      key={r}
                      onSelect={() => room.send('chat:report', { messageId: l.id, reason: r })}
                    >
                      {t(`chat.reason.${r}`)}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </li>
    );
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        variant={overlay ? 'secondary' : 'default'}
        className={cn(
          'fixed z-[60] h-12 rounded-full shadow-lg',
          overlay
            ? 'top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))]'
            : 'right-4 bottom-20 sm:bottom-6',
        )}
        aria-label={t('chat.open')}
      >
        <MessageCircle aria-hidden />
        <span className="hidden sm:inline">{t('chat.title')}</span>
        {unread > 0 && (
          <span className="bg-destructive rounded-full px-1.5 text-xs text-white">
            {t('chat.unread', { count: unread })}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{t('chat.title')}</SheetTitle>
          </SheetHeader>
          <ol ref={list} aria-live="polite" className="flex-1 space-y-2 overflow-y-auto p-4">
            {chat.map((l) => (
              <Line key={String(l.id)} l={l} />
            ))}
          </ol>
          <div
            className="space-y-2 border-t p-3"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <div
              className="flex gap-1 overflow-x-auto pb-1"
              role="group"
              aria-label={t('chat.quick')}
            >
              {QUICK_CHAT.map((_, i) => (
                <Button
                  key={i}
                  size="xs"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => room.send('quickChat', { id: i })}
                >
                  {quick(i)}
                </Button>
              ))}
            </div>
            {isMuted ? (
              <p className="text-muted-foreground text-sm" role="status">
                {t('chat.muted', {
                  time: new Date(mutedUntil).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={150}
                  placeholder={t('chat.placeholder')}
                  aria-label={t('chat.placeholder')}
                  className="bg-background min-w-0 flex-1 rounded-md border px-3 py-2"
                  enterKeyHint="send"
                />
                <Button type="submit" size="icon" aria-label={t('chat.send')}>
                  <Send aria-hidden />
                </Button>
              </form>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
