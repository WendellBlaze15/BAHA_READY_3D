import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { levelConfigSchema } from '@baha/shared/level-config';
import { getSupabaseServer } from '@/lib/supabase/server';
import { StormMap, type MapLevel } from '@/components/levels/storm-map';
import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('levels');
  return { title: t('title') };
}

export default async function LevelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('levels');
  const supabase = await getSupabaseServer();
  const [{ data: levels }, { data: hazards }] = await Promise.all([
    supabase
      .from('levels')
      .select(
        'id, slug, name_fil, name_en, sort_order, level_versions!levels_current_version_fk(config)',
      )
      .order('sort_order'),
    supabase.from('hazards').select('key, name_fil, name_en'),
  ]);
  const map: MapLevel[] = (levels ?? []).flatMap((l) => {
    const v = l.level_versions as unknown as { config: unknown } | null;
    const parsed = levelConfigSchema.safeParse(v?.config);
    return parsed.success
      ? [{ id: l.id, slug: l.slug, name_fil: l.name_fil, name_en: l.name_en, config: parsed.data }]
      : [];
  });
  const hazardNames = Object.fromEntries(
    (hazards ?? []).map((h) => [h.key, locale === 'en' ? h.name_en : h.name_fil]),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lede')}</p>
        <StormSignalMeter value={5} label={t('title')} className="max-w-sm" />
      </div>
      <Suspense>
        <StormMap levels={map} hazardNames={hazardNames} />
      </Suspense>
    </div>
  );
}
