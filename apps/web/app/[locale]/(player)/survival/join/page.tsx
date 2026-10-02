import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JoinCode } from '@/components/survival/join-code';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survival');
  return { title: t('joinPage.title') };
}

export default async function JoinSurvivalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale((await params).locale);
  return <JoinCode />;
}
