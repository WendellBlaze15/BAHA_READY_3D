import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ProfilePage } from '@/components/profile/profile-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profilePage');
  return { title: t('title') };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ProfilePage />;
}
