import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AchievementsGrid } from '@/components/achievements/achievements-grid';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('achievementsPage');
  return { title: t('title') };
}

export default async function AchievementsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('achievementsPage');
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lede')}</p>
      </div>
      <AchievementsGrid />
    </div>
  );
}
