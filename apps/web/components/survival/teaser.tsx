import { getTranslations } from 'next-intl/server';
import { LifeBuoy } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

/** Guest teaser (landing) or player entry card (home) for Survival Mode. */
export async function SurvivalTeaser({ variant }: { variant: 'guest' | 'player' }) {
  const t = await getTranslations('survival.teaser');
  return (
    <section
      aria-labelledby="survival-teaser"
      className="flex flex-col gap-3 rounded-xl border bg-gradient-to-br from-sky-900 to-slate-900 p-5 text-white sm:flex-row sm:items-center"
    >
      <LifeBuoy className="size-10 shrink-0 text-amber-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="survival-teaser" className="text-xl font-bold">
          {t('title')}
        </h2>
        <p className="opacity-90">{variant === 'guest' ? t('body') : t('card')}</p>
      </div>
      <Button asChild size="lg" variant="secondary">
        <Link href={variant === 'guest' ? '/sign-up' : '/survival'}>
          {variant === 'guest' ? t('cta') : t('play')}
        </Link>
      </Button>
    </section>
  );
}
