'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Radio, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useLiveChannel } from '@/lib/realtime/live';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Player lobby: enter the projector code, wait; the facilitator's "start" launches the level. */
export function LiveLobby({ me }: { me: { id: string; username: string } }) {
  const t = useTranslations('fac');
  const tg = useTranslations('groupsPage');
  const router = useRouter();
  const [code, setCode] = useState('');
  const [session, setSession] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const presence = useMemo(
    () => ({ user_id: me.id, username: me.username, phase: 'lobby' as const }),
    [me],
  );
  const { players } = useLiveChannel(session?.id ?? null, presence, {
    onStart: ({ slug }) => router.push(`/play/${slug}?mode=live&session=${session!.id}`),
  });

  if (!session) {
    return (
      <form
        className="bg-card flex flex-wrap items-end gap-2 rounded-2xl border p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          // RLS: members can only see sessions of their own groups.
          const { data } = await getSupabaseBrowser()
            .from('live_sessions')
            .select('id, status')
            .eq('code', code)
            .neq('status', 'ended')
            .maybeSingle();
          setBusy(false);
          if (!data) toast.error(tg('empty'));
          else setSession({ id: data.id });
        }}
      >
        <Input
          value={code}
          onChange={(e) =>
            setCode(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 6),
            )
          }
          aria-label={t('sessionCode')}
          placeholder="ABC234"
          className="font-display h-12 flex-1 text-2xl tracking-[0.3em]"
        />
        <Button
          type="submit"
          disabled={busy || code.length !== 6}
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />} {tg('join')}
        </Button>
      </form>
    );
  }
  return (
    <div className="bg-storm-slate text-mist auth-rain relative overflow-hidden rounded-2xl p-8 text-center">
      <div className="relative z-10 space-y-3">
        <Radio className="text-signal-amber mx-auto size-10 animate-pulse" aria-hidden />
        <p className="text-2xl font-bold" role="status">
          {t('waiting')}
        </p>
        <p className="flex items-center justify-center gap-2">
          <Users className="size-4" aria-hidden /> {players.length}
        </p>
      </div>
    </div>
  );
}
