import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { SafeMarkdown } from '@/components/tips/markdown';
import { MarkTipRead } from '@/components/tips/mark-tip-read';

type Params = { params: Promise<{ locale: string; slug: string }> };

async function getTip(slug: string) {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from('tips').select('*').eq('slug', slug).maybeSingle();
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const tip = await getTip(slug);
  if (!tip) return {};
  return { title: locale === 'en' ? tip.title_en : tip.title_fil };
}

export default async function TipPage({ params }: Params) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tipsPage');
  const tip = await getTip(slug);
  if (!tip) notFound();

  return (
    <article className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link href="/tips" className="text-link inline-flex min-h-11 items-center gap-1 underline">
        <ArrowLeft className="size-4" aria-hidden /> {t('back')}
      </Link>
      <p className="text-muted-foreground text-sm font-bold">
        {t(`categories.${tip.category}` as 'categories.before')}
      </p>
      <h1 className="text-4xl leading-tight font-bold">
        {locale === 'en' ? tip.title_en : tip.title_fil}
      </h1>
      <SafeMarkdown>{locale === 'en' ? tip.body_en : tip.body_fil}</SafeMarkdown>
      {tip.needs_verification && (
        <p className="bg-signal-amber/15 border-signal-amber rounded-sm border-l-4 px-3 py-2 text-sm">
          {t('verifyBadge')}
        </p>
      )}
      <MarkTipRead tipId={tip.id} />
    </article>
  );
}
