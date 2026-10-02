import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NewGame } from '@/components/survival/new-game';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survival');
  return { title: t('new.title') };
}

export default async function NewSurvivalGamePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  return <NewGame />;
}
