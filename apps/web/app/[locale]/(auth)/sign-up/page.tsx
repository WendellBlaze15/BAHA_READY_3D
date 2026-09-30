import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Check, GraduationCap } from 'lucide-react';
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
      <Suspense>
        <EmailOtpFlow mode="signup" />
      </Suspense>
      <div className="border-primary/30 bg-primary/5 flex items-start gap-3 rounded-lg border p-4">
        <GraduationCap className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="space-y-2 text-sm">
          <p className="font-bold">{t('auth.facilitatorTitle')}</p>
          <p className="text-muted-foreground">
            {asFacilitator ? t('auth.facilitatorSelected') : t('auth.facilitatorHow')}
          </p>
          {!asFacilitator && (
            <Link
              href={{ pathname: '/sign-up', query: { next: '/apply' } }}
              className="text-link inline-flex min-h-11 items-center font-bold underline"
            >
              {t('auth.facilitatorCta')}
            </Link>
          )}
        </div>
      </div>
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
