'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Check, Copy, Crown, Share2, UserX } from 'lucide-react';
import { DIFFICULTIES, ROLES } from '@baha/shared/survival';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { mapValues, useRoomState, useSession } from '@/game/survival/session-store';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type P = {
  userId: string;
  username: string;
  role: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  joinedAt: number;
  avatar: string;
};

export function Lobby() {
  const t = useTranslations('survival');
  const room = useSession((s) => s.room)!;
  const myId = useSession((s) => s.myId);
  const view = useRoomState((s) => ({
    code: s.code as string,
    mode: s.mode as 'solo' | 'coop',
    difficulty: s.difficulty as string,
    hostId: s.hostId as string,
    max: s.maxPlayers as number,
    players: mapValues<P>(s.players)
      .map(([, p]) => ({ ...p }))
      .sort((a, b) => a.joinedAt - b.joinedAt),
  }));
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const link =
    typeof window !== 'undefined' && view
      ? `${window.location.origin}/survival/join/${view.code}`
      : '';

  useEffect(() => {
    if (link)
      void QRCode.toDataURL(link, { margin: 1, width: 180 })
        .then(setQr)
        .catch(() => setQr(null));
  }, [link]);

  if (!view) return null;
  const me = view.players.find((p) => p.userId === myId);
  const isHost = view.hostId === myId;
  const takenRoles = new Set(view.players.filter((p) => p.userId !== myId).map((p) => p.role));
  const send = (type: string, payload: object = {}) => room.send(type, payload);
  const allReady = view.players.length > 0 && view.players.every((p) => p.ready && p.connected);

  const share = async () => {
    const text = t('lobby.shareText', { code: view.code });
    if (navigator.share)
      await navigator.share({ title: t('title'), text, url: link }).catch(() => {});
    else await navigator.clipboard.writeText(`${text} ${link}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 pb-24">
      <h1 className="text-3xl font-bold">{t('lobby.title')}</h1>

      {view.mode === 'coop' && (
        <section className="bg-card flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-sm">{t('lobby.code')}</p>
            <p
              className="font-mono text-4xl font-bold tracking-[0.3em] break-all"
              aria-live="polite"
            >
              {view.code}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(view.code);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{' '}
                {copied ? t('lobby.copied') : t('lobby.copy')}
              </Button>
              <Button variant="outline" onClick={share}>
                <Share2 aria-hidden /> {t('lobby.share')}
              </Button>
            </div>
          </div>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qr}
              alt={t('lobby.qr')}
              width={140}
              height={140}
              className="self-center rounded-md bg-white p-1"
            />
          )}
        </section>
      )}

      <section aria-labelledby="players-h" className="space-y-3">
        <h2 id="players-h" className="font-semibold">
          {t('lobby.players', { count: view.players.length, max: view.max })}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: view.max }, (_, i) => view.players[i]).map((p, i) =>
            p ? (
              <li
                key={p.userId}
                className={cn(
                  'bg-card flex min-w-0 items-center gap-3 rounded-xl border p-3',
                  !p.connected && 'opacity-60',
                )}
              >
                <BlockyAvatar config={safeAvatar(p.avatar)} size={48} title={p.username} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate font-semibold">
                    {p.isHost && (
                      <Crown className="text-signal-amber size-4 shrink-0" aria-label={t('host')} />
                    )}
                    <span className="truncate">{p.username}</span>
                    {p.userId === myId && (
                      <span className="text-muted-foreground text-xs">({t('lobby.you')})</span>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {p.role ? t(`role.${p.role}` as 'role.medic') : t('lobby.pickRole')}
                  </p>
                </div>
                <Badge variant={p.ready ? 'default' : 'outline'}>
                  {p.ready ? t('lobby.ready') : t('lobby.notReady')}
                </Badge>
                {isHost && p.userId !== myId && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('lobby.kick')} ${p.username}`}
                    onClick={() => send('lobby:kick', { userId: p.userId })}
                  >
                    <UserX aria-hidden />
                  </Button>
                )}
              </li>
            ) : (
              <li
                key={`empty${i}`}
                className="text-muted-foreground flex items-center rounded-xl border border-dashed p-3 text-sm"
              >
                {t('lobby.empty')}
              </li>
            ),
          )}
        </ul>
      </section>

      {view.mode === 'coop' && me && (
        <section aria-labelledby="role-h" className="space-y-2">
          <h2 id="role-h" className="font-semibold">
            {t('lobby.pickRole')}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {ROLES.map((r) => {
              const taken = takenRoles.has(r);
              return (
                <button
                  key={r}
                  type="button"
                  disabled={taken}
                  aria-pressed={me.role === r}
                  onClick={() => send('lobby:setRole', { role: r })}
                  className={cn(
                    'bg-card min-w-0 rounded-lg border-2 p-3 text-left disabled:opacity-40',
                    me.role === r ? 'border-primary' : 'hover:border-foreground/30',
                  )}
                >
                  <span className="block font-semibold">{t(`role.${r}`)}</span>
                  <span className="text-muted-foreground block text-xs">{t(`roleHint.${r}`)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="bg-card rounded-xl border p-3">
        <div className="flex flex-wrap gap-2">
          {me && (
            <Button
              size="lg"
              variant={me.ready ? 'outline' : 'secondary'}
              className="h-12 flex-1 sm:flex-none"
              onClick={() => send('lobby:ready', { ready: !me.ready })}
            >
              {me.ready ? t('lobby.unready') : t('lobby.setReady')}
            </Button>
          )}
          {isHost ? (
            <Button
              size="lg"
              className="h-12 flex-1 sm:flex-none"
              disabled={!allReady}
              onClick={() => send('lobby:start')}
            >
              {t('lobby.start')}
            </Button>
          ) : (
            <p className="text-muted-foreground self-center text-sm">{t('lobby.waitingHost')}</p>
          )}
        </div>
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">{t('new.difficulty')}</h2>
        <div className="flex flex-wrap gap-2" role="group">
          {DIFFICULTIES.map((d) => (
            <Button
              key={d}
              variant={view.difficulty === d ? 'default' : 'outline'}
              disabled={!isHost}
              aria-pressed={view.difficulty === d}
              onClick={() => send('lobby:setDifficulty', { difficulty: d })}
            >
              {t(`difficulty.${d}`)}
            </Button>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          {t(`difficultyHint.${view.difficulty}` as 'difficultyHint.normal')}
        </p>
      </section>
    </div>
  );
}

export function safeAvatar(json: string | undefined): Partial<AvatarConfig> | null {
  try {
    return json ? (JSON.parse(json) as Partial<AvatarConfig>) : null;
  } catch {
    return null;
  }
}
