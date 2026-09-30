import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AvatarStudio } from '@/components/avatar/avatar-studio';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('avatar');
  return { title: t('title') };
}

export default async function AvatarPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('avatar');
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lede')}</p>
      </div>
      <AvatarStudio />
    </div>
  );
}
