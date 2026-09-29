import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgeCheck, CircleHelp, Phone } from 'lucide-react';
import { getSupabaseServer } from '@/lib/supabase/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('hotlinesPage');
  return { title: t('title') };
}

export default async function HotlinesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('hotlinesPage');
  const supabase = await getSupabaseServer();
  const { data: hotlines } = await supabase.from('hotlines').select('*').order('sort_order');

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-lg">{t('lede')}</p>
      </div>
      <ul className="space-y-3">
        {(hotlines ?? []).map((h) => (
          <li key={h.id} className="bg-card flex items-center gap-4 rounded-lg border p-4">
            <div className="min-w-0 flex-1">
              <p className="font-bold">{h.agency}</p>
              <p className="text-muted-foreground text-sm">{h.area}</p>
              <p className="mt-1 flex items-center gap-1 text-xs">
                {h.is_verified ? (
                  <>
                    <BadgeCheck className="text-evac-green size-4" aria-hidden /> {t('verified')}
                  </>
                ) : (
                  <>
                    <CircleHelp className="text-signal-amber size-4" aria-hidden />{' '}
                    {t('unverified')}
                  </>
                )}
              </p>
            </div>
            <a
              href={`tel:${h.number.replace(/[^0-9+]/g, '')}`}
              aria-label={t('call', { agency: h.agency })}
              className="bg-signal-red font-display flex min-h-12 items-center gap-2 rounded-lg px-4 text-2xl font-bold text-white"
            >
              <Phone className="size-5" aria-hidden /> {h.number}
            </a>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">{t('localNote')}</p>
    </div>
  );
}
