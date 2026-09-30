import { getTranslations } from 'next-intl/server';
import { Backpack, LifeBuoy, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';
import { DioramaPoster } from '@/components/landing/diorama-poster';

/**
 * Split-screen auth layout: storm-bulletin story panel (desktop) + focused form.
 * On phones the panel collapses into a compact branded band above the form.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations();
  const bullets = [
    { icon: Backpack, text: t('authSide.bullet1') },
    { icon: LifeBuoy, text: t('authSide.bullet2') },
    { icon: ShieldCheck, text: t('authSide.bullet3') },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Story panel (desktop) */}
      <aside
        aria-hidden
        className="bg-storm-slate text-mist auth-rain sticky top-0 hidden h-dvh overflow-hidden lg:flex lg:flex-col"
      >
        <div className="relative z-10 flex h-full flex-col justify-between gap-6 p-10 xl:p-12">
          <Link href="/" tabIndex={-1} className="flex items-center gap-2">
            <BrandMark className="size-9" />
            <span className="font-display text-2xl font-bold">{t('common.appName')}</span>
          </Link>

          <div className="space-y-5">
            <p className="font-display text-signal-amber text-lg font-semibold">
              {t('landing.eyebrow')}
            </p>
            <h2 className="max-w-md text-4xl leading-[1.04] font-bold xl:text-5xl">
              {t('authSide.headline')}
            </h2>
            <StormSignalMeter
              value={5}
              label={t('landing.meterLabel')}
              className="[&_span]:text-mist/70 max-w-sm"
            />
            <div className="max-w-[340px] overflow-hidden rounded-2xl border border-white/10 shadow-2xl [@media(max-height:760px)]:hidden">
              <DioramaPoster />
            </div>
          </div>

          <ul className="grid max-w-md gap-3">
            {bullets.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="bg-mist/10 flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Icon className="text-signal-amber size-5" />
                </span>
                <span className="text-mist/90">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form side */}
      <div className="flex min-h-dvh flex-col">
        {/* Phone/tablet hero band */}
        <div className="bg-storm-slate text-mist auth-rain relative overflow-hidden lg:hidden">
          <div className="relative z-10 flex items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-5">
            <Link href="/" className="flex min-h-11 items-center gap-2">
              <BrandMark className="size-8" />
              <span className="font-display text-xl font-bold">{t('common.appName')}</span>
            </Link>
            <div className="[&_button]:text-mist ml-auto flex items-center [&_button:hover]:bg-white/10">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </div>
          <div className="relative z-10 px-4 pb-6">
            <StormSignalMeter
              value={5}
              label={t('landing.meterLabel')}
              showNumbers={false}
              size="sm"
            />
          </div>
        </div>

        <header className="hidden h-16 items-center justify-end gap-1 px-6 lg:flex">
          <LanguageSwitcher />
          <ThemeToggle />
        </header>

        <main
          id="main"
          className="flex flex-1 items-start justify-center px-4 py-8 sm:px-6 lg:items-center lg:py-4"
        >
          <div className="bg-card w-full max-w-[440px] rounded-2xl border p-6 shadow-sm sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            {children}
          </div>
        </main>

        <footer className="text-muted-foreground px-6 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center text-xs lg:text-left">
          {t('footer.privacyNotice')} ·{' '}
          <Link href="/privacy" className="underline">
            {t('nav.privacy')}
          </Link>{' '}
          ·{' '}
          <Link href="/hotlines" className="underline">
            {t('nav.hotlines')}
          </Link>
        </footer>
      </div>
    </div>
  );
}
