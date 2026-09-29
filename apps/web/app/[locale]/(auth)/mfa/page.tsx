import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MfaFlow } from '@/components/auth/mfa-flow';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('mfa');
  return { title: t('title'), robots: { index: false } };
}

export default async function MfaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('mfa');
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <Suspense>
        <MfaFlow />
      </Suspense>
    </div>
  );
}
