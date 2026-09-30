import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { LiveLobby } from '@/components/live/live-lobby';

export default async function LivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('fac');
  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub ?? '';
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', uid)
    .maybeSingle();
  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-4xl font-bold">{t('liveTitle')}</h1>
        <p className="text-muted-foreground">{t('liveLede')}</p>
      </div>
      <LiveLobby me={{ id: uid, username: (profile?.username as string) ?? '' }} />
    </div>
  );
}
