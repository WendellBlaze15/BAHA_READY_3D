import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HomeDashboard } from '@/components/dashboard/home-dashboard';
import { SurvivalTeaser } from '@/components/survival/teaser';
import { getClaims } from '@/lib/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('dashboard');
  return { title: t('title') };
}

export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [claims, q, t] = await Promise.all([
    getClaims(),
    searchParams,
    getTranslations('survival'),
  ]);
  return (
    <>
      {q.notice === 'survival' && (
        <p role="status" className="bg-card mx-auto mt-4 max-w-6xl rounded-lg border p-4 lg:mx-8">
          {t('notEligible')}
        </p>
      )}
      <HomeDashboard />
      {claims?.can_play_survival && (
        <div className="mx-auto max-w-6xl px-4 pb-8 lg:px-8">
          <SurvivalTeaser variant="player" />
        </div>
      )}
    </>
  );
}
