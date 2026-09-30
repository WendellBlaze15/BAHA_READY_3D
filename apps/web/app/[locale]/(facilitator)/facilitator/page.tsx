import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FacDashboard } from '@/components/facilitator/fac-dashboard';
import { contentLabels } from '@/lib/content-labels';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('fac');
  return { title: t('dashboardTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FacDashboard mistakeLabels={await contentLabels()} />;
}
