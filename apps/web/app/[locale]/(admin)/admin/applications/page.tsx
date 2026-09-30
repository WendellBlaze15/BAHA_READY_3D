import { setRequestLocale } from 'next-intl/server';
import { ApplicationsQueue } from '@/components/admin/applications-queue';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ApplicationsQueue />;
}
