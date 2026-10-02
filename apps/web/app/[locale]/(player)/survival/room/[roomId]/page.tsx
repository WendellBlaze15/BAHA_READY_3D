import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SurvivalSession } from '@/components/survival/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survival');
  return { title: t('title'), robots: { index: false } };
}

export default async function SurvivalRoomPage({
  params,
}: {
  params: Promise<{ locale: string; roomId: string }>;
}) {
  const { locale, roomId } = await params;
  setRequestLocale(locale);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(roomId)) notFound();
  return <SurvivalSession roomId={roomId} />;
}
