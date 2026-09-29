import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return { title: t('aboutTitle') };
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <article className="prose-width mx-auto space-y-4 px-4 py-8">
      <h1 className="text-4xl font-bold">{t('aboutTitle')}</h1>
      <p className="text-lg leading-relaxed">{t('aboutBody')}</p>
      <p className="bg-signal-amber/15 border-signal-amber rounded-sm border-l-4 px-3 py-2">
        {t('aboutContent')}
      </p>
    </article>
  );
}
