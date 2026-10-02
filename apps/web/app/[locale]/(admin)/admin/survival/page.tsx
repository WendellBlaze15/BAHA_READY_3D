import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SurvivalAdmin } from '@/components/admin/survival/survival-admin';
import { hasPermission } from '@/lib/auth/claims';
import { getClaims } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('survivalAdmin');
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const claims = await getClaims();
  const can = (p: Parameters<typeof hasPermission>[1]) => !!claims && hasPermission(claims, p);
  return (
    <SurvivalAdmin
      caps={{
        monitor: can('survival.rooms.monitor'),
        forceClose: can('survival.rooms.force_close'),
        config: can('survival.config.manage'),
        reports: can('survival.reports.review'),
        toggle: can('survival.system.toggle'),
      }}
    />
  );
}
