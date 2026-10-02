import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SurvivalHub } from '@/components/survival/hub';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survival');
  return { title: t('title') };
}

export default async function SurvivalPage({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <SurvivalHub />;
}
