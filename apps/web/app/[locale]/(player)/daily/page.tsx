import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CalendarDays, CloudRain, Flame, Moon, Play, Waves } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('daily');
  return { title: t('title') };
}

export default async function DailyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('daily');
  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const [{ data: daily }, { data: streak }] = await Promise.all([
    supabase
      .from('daily_challenges')
      .select('date, level_id, modifiers, levels(slug, name_fil, name_en)')
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('streaks')
      .select('current, longest')
      .eq('user_id', claims?.claims.sub ?? '')
      .maybeSingle(),
  ]);
  const level = daily?.levels as unknown as {
    slug: string;
    name_fil: string;
    name_en: string;
  } | null;
  const mods = (daily?.modifiers ?? {}) as {
    rainBoost?: number;
    waterRiseBoost?: number;
    night?: boolean;
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-4xl font-bold">
          <CalendarDays className="size-8" aria-hidden /> {t('title')}
        </h1>
        <p className="text-muted-foreground">{t('lede')}</p>
      </div>
      {daily && level ? (
        <section className="bg-storm-slate text-mist auth-rain relative space-y-4 overflow-hidden rounded-2xl p-6">
          <div className="relative z-10 space-y-4">
            <p className="font-display text-signal-amber text-lg font-semibold">{today}</p>
            <h2 className="text-3xl font-bold">
              {t('today', { level: locale === 'en' ? level.name_en : level.name_fil })}
            </h2>
            <div>
              <p className="mb-2 text-sm font-bold opacity-80">{t('modifiers')}</p>
              <ul className="flex flex-wrap gap-2 text-sm">
                {(mods.rainBoost ?? 0) > 0 && (
                  <li className="bg-mist/10 flex items-center gap-1.5 rounded-sm px-2 py-1">
                    <CloudRain className="size-4" aria-hidden /> {t('rainBoost')}
                  </li>
                )}
                {(mods.waterRiseBoost ?? 0) > 0 && (
                  <li className="bg-mist/10 flex items-center gap-1.5 rounded-sm px-2 py-1">
                    <Waves className="size-4" aria-hidden /> {t('riseBoost')}
                  </li>
                )}
                {mods.night && (
                  <li className="bg-mist/10 flex items-center gap-1.5 rounded-sm px-2 py-1">
                    <Moon className="size-4" aria-hidden /> {t('night')}
                  </li>
                )}
              </ul>
            </div>
            <Button
              asChild
              size="lg"
              className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-14 w-full text-lg font-bold"
            >
              <Link href={`/play/${level.slug}?mode=daily`}>
                <Play className="fill-current" aria-hidden /> {t('play')}
              </Link>
            </Button>
          </div>
        </section>
      ) : (
        <p className="text-muted-foreground">{t('none')}</p>
      )}
      <section className="bg-card flex items-center gap-4 rounded-lg border p-5">
        <Flame className="text-signal-red size-10 shrink-0" aria-hidden />
        <div>
          <p className="text-sm font-bold">{t('streak')}</p>
          <p className="font-display text-3xl font-bold">{streak?.current ?? 0} 🔥</p>
          <p className="text-muted-foreground text-sm">{t('streakBody')}</p>
        </div>
      </section>
    </div>
  );
}
