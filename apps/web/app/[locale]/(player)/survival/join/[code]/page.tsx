import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JoinCode } from '@/components/survival/join-code';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survival');
  return { title: t('joinPage.title'), robots: { index: false } };
}

/** Invite link / QR target: /survival/join/<CODE> (also bahaready://survival/join/<CODE>). */
export default async function JoinSurvivalCodePage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  return <JoinCode initial={code} />;
}
