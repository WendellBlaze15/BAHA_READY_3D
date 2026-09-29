import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return { title: t('privacyTitle') };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  const sections = [
    ['privacyCollectTitle', 'privacyCollect'],
    ['privacyUseTitle', 'privacyUse'],
    ['privacyMinorsTitle', 'privacyMinors'],
    ['privacyRightsTitle', 'privacyRights'],
  ] as const;
  return (
    <article className="prose-width mx-auto space-y-5 px-4 py-8">
      <h1 className="text-4xl font-bold">{t('privacyTitle')}</h1>
      <p className="text-lg">{t('privacyIntro')}</p>
      {sections.map(([h, b]) => (
        <section key={h} className="space-y-1">
          <h2 className="text-2xl font-bold">{t(h)}</h2>
          <p className="leading-relaxed">{t(b)}</p>
        </section>
      ))}
      <p>{t('privacyContact')}</p>
      <p className="text-muted-foreground text-sm">{t('updated')}</p>
    </article>
  );
}
