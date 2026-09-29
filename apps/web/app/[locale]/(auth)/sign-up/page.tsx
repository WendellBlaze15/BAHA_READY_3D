import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { EmailOtpFlow } from '@/components/auth/email-otp-flow';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signUpTitle') };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{t('auth.signUpTitle')}</h1>
        <p className="text-muted-foreground">{t('auth.signUpLede')}</p>
      </div>
      <Suspense>
        <EmailOtpFlow mode="signup" />
      </Suspense>
      <p className="text-muted-foreground text-xs">
        {t('auth.privacyNote')}{' '}
        <Link href="/privacy" className="underline">
          {t('nav.privacy')}
        </Link>
        {' · '}
        <Link href="/terms" className="underline">
          {t('nav.terms')}
        </Link>
      </p>
      <p className="text-sm">
        {t('auth.haveAccount')}{' '}
        <Link href="/sign-in" className="text-link font-bold underline">
          {t('auth.signInTitle')}
        </Link>
      </p>
    </div>
  );
}
