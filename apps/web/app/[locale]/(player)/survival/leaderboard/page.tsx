import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SurvivalLeaderboard } from '@/components/survival/leaderboard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survival');
  return { title: t('board.title') };
}

export default async function SurvivalLeaderboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  return <SurvivalLeaderboard />;
}
