import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal');
  return { title: t('termsTitle') };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  return (
    <article className="prose-width mx-auto space-y-4 px-4 py-8">
      <h1 className="text-4xl font-bold">{t('termsTitle')}</h1>
      <ol className="list-decimal space-y-3 pl-6 text-lg leading-relaxed">
        {(['terms1', 'terms2', 'terms3', 'terms4'] as const).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      <p className="text-muted-foreground text-sm">{t('updated')}</p>
    </article>
  );
}
