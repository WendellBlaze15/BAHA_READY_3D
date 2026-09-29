import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { NotificationsCenter } from '@/components/notifications/notifications-center';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notificationsPage');
  return { title: t('title') };
}

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NotificationsCenter />;
}
