import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, Gamepad2, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';
import { EmailOtpFlow } from '@/components/auth/email-otp-flow';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signUpTitle') };
}

export default async function SignUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const asFacilitator = (await searchParams).next === '/apply';
  setRequestLocale(locale);
  const t = await getTranslations();
  const perks = [t('authSide.bullet1'), t('authSide.bullet2')];
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <p className="text-primary font-display text-lg font-semibold">{t('landing.eyebrow')}</p>
        <h1 className="text-3xl leading-tight font-bold sm:text-4xl">{t('auth.signUpTitle')}</h1>
        <p className="text-muted-foreground">{t('auth.signUpLede')}</p>
      </div>
      <ul className="space-y-2">
        {perks.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm">
            <Check className="text-evac-green mt-0.5 size-4 shrink-0" aria-hidden /> {p}
          </li>
        ))}
      </ul>
      <nav aria-label={t('auth.accountTypeLabel')} className="space-y-2">
        <p className="text-sm font-medium">{t('auth.accountTypeLabel')}</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [false, Gamepad2, t('auth.typePlayer'), t('auth.typePlayerHint')],
              [true, GraduationCap, t('auth.typeFacilitator'), t('auth.typeFacilitatorHint')],
            ] as const
          ).map(([fac, Icon, label, hint]) => {
            const active = fac === asFacilitator;
            return (
              <Link
                key={label}
                href={fac ? { pathname: '/sign-up', query: { next: '/apply' } } : '/sign-up'}
                replace
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-start gap-2.5 rounded-lg border-2 p-3 transition-colors',
                  active
                    ? 'border-primary bg-primary/5'
                    : 'bg-card hover:border-foreground/25 border-transparent',
                )}
              >
                <Icon
                  className={cn(
                    'mt-0.5 size-5 shrink-0',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                  aria-hidden
                />
                <span>
                  <span className="block text-sm font-bold">{label}</span>
                  <span className="text-muted-foreground block text-xs leading-snug">{hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
        {asFacilitator && (
          <p className="bg-muted/60 rounded-lg p-3 text-sm leading-relaxed">
            {t('auth.facilitatorSteps')}
          </p>
        )}
      </nav>
      <Suspense>
        <EmailOtpFlow mode="signup" />
      </Suspense>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t('auth.privacyNote')}{' '}
        <Link href="/privacy" className="underline">
          {t('nav.privacy')}
        </Link>
        {' · '}
        <Link href="/terms" className="underline">
          {t('nav.terms')}
        </Link>
      </p>
      <div className="bg-muted/60 flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
        <p className="text-sm font-medium">{t('auth.haveAccount')}</p>
        <Link
          href="/sign-in"
          className="border-foreground/15 bg-card hover:bg-accent inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-bold"
        >
          {t('auth.signInTitle')}
        </Link>
      </div>
    </div>
  );
}
