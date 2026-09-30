import { setRequestLocale } from 'next-intl/server';
import { ReportsView } from '@/components/facilitator/reports-view';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ReportsView />;
}
