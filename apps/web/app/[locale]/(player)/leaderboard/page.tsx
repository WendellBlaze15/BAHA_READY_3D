import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { LeaderboardView } from '@/components/leaderboard/leaderboard-view';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('leaderboard');
  return { title: t('title') };
}

export default async function LeaderboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('leaderboard');
  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub ?? '';
  const [{ data: levels }, { data: profile }, { data: groups }] = await Promise.all([
    supabase.from('levels').select('id, name_fil, name_en').gt('id', 0).order('sort_order'),
    supabase.from('profiles').select('barangay').eq('id', uid).maybeSingle(),
    supabase.from('groups').select('id, name').eq('is_archived', false).order('name'),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lede')}</p>
      </div>
      <LeaderboardView
        levels={levels ?? []}
        groups={groups ?? []}
        hasBarangay={!!profile?.barangay}
      />
    </div>
  );
}
