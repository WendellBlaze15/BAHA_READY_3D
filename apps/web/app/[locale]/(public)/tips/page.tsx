import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { TipsLibrary } from '@/components/tips/tips-library';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tipsPage');
  return { title: t('title'), description: t('lede') };
}

export default async function TipsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tipsPage');
  const supabase = await getSupabaseServer();
  const [{ data: tips }, { data: claims }] = await Promise.all([
    supabase.from('tips').select('*').order('sort_order'),
    supabase.auth.getClaims(),
  ]);
  const unlocked = claims?.claims
    ? ((await supabase.from('player_tips').select('tip_id, read_at')).data ?? [])
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground prose-width mt-1 text-lg">{t('lede')}</p>
        <p className="bg-signal-amber/15 border-signal-amber mt-3 inline-block rounded-sm border-l-4 px-3 py-1 text-sm">
          {t('verifyBadge')}
        </p>
      </div>
      <TipsLibrary initialTips={tips ?? []} unlocked={unlocked} />
    </div>
  );
}
