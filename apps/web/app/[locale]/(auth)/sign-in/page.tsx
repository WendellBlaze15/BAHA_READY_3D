import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmailOtpFlow } from '@/components/auth/email-otp-flow';
import { PasswordSignInForm } from '@/components/auth/password-sign-in-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signInTitle'), robots: { index: false } };
}

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth');
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">{t('signInTitle')}</h1>
        <p className="text-muted-foreground">{t('signInLede')}</p>
      </div>
      <Suspense>
        <Tabs defaultValue="code" className="gap-5">
          <TabsList className="grid h-11 w-full grid-cols-2">
            <TabsTrigger value="code" className="min-h-9">
              {t('tabCode')}
            </TabsTrigger>
            <TabsTrigger value="password" className="min-h-9">
              {t('tabPassword')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="code">
            <EmailOtpFlow mode="signin" />
          </TabsContent>
          <TabsContent value="password">
            <PasswordSignInForm />
          </TabsContent>
        </Tabs>
      </Suspense>
      <p className="text-sm">
        {t('noAccount')}{' '}
        <Link href="/sign-up" className="text-link font-bold underline">
          {t('signUpTitle')}
        </Link>
      </p>
    </div>
  );
}
