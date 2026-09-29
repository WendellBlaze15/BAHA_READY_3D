import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Backpack, LifeBuoy, Route } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';
import { DioramaPoster } from '@/components/landing/diorama-poster';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('landing');

  const features = [
    { icon: Backpack, title: t('feature1Title'), body: t('feature1Body') },
    { icon: Route, title: t('feature2Title'), body: t('feature2Body') },
    { icon: LifeBuoy, title: t('feature3Title'), body: t('feature3Body') },
  ];

  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-10 pb-12 md:grid-cols-2 md:pt-16">
        <div className="space-y-6">
          <p className="text-muted-foreground font-display text-lg font-semibold">{t('eyebrow')}</p>
          <h1 className="text-4xl leading-[1.05] font-bold md:text-[61px]">{t('headline')}</h1>
          <p className="prose-width text-lg">{t('lede')}</p>
          <StormSignalMeter value={5} label={t('meterLabel')} className="max-w-sm" />
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 text-base font-bold"
            >
              <Link href="/play/tutorial">{t('playGuest')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="min-h-12 text-base">
              <Link href="/sign-up">{t('createAccount')}</Link>
            </Button>
          </div>
        </div>
        <div className="bg-card overflow-hidden rounded-2xl border">
          <DioramaPoster />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4" aria-labelledby="features-title">
        <h2 id="features-title" className="mb-6 text-2xl font-bold">
          {t('featuresTitle')}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <li key={title} className="bg-card rounded-lg border p-5">
              <Icon className="text-primary mb-3 size-7" aria-hidden />
              <h3 className="text-xl font-bold">{title}</h3>
              <p className="text-muted-foreground mt-1">{body}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
