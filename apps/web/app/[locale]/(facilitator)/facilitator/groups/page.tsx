import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GroupsManager } from '@/components/facilitator/groups-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('fac');
  return { title: t('groupsTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense>
      <GroupsManager />
    </Suspense>
  );
}
