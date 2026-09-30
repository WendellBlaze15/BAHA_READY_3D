import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { KeyRound, Mail } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmailOtpFlow } from '@/components/auth/email-otp-flow';
import { PasswordSignInForm } from '@/components/auth/password-sign-in-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signInTitle'), robots: { index: false } };
}

const TAB =
  'data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground h-10 gap-2 rounded-md font-bold data-[state=active]:shadow-sm';

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <p className="text-primary font-display text-lg font-semibold">
          {t('authSide.welcomeBack')}
        </p>
        <h1 className="text-3xl leading-tight font-bold sm:text-4xl">{t('auth.signInTitle')}</h1>
        <p className="text-muted-foreground">{t('auth.signInLede')}</p>
      </div>
      <Suspense>
        <Tabs defaultValue="code" className="gap-6">
          <TabsList className="bg-muted grid h-12 w-full grid-cols-2 rounded-lg p-1">
            <TabsTrigger value="code" className={TAB}>
              <Mail className="size-4" aria-hidden /> {t('auth.tabCode')}
            </TabsTrigger>
            <TabsTrigger value="password" className={TAB}>
              <KeyRound className="size-4" aria-hidden /> {t('auth.tabPassword')}
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
      <div className="flex items-center gap-3" aria-hidden>
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-xs">{t('authSide.or')}</span>
        <span className="bg-border h-px flex-1" />
      </div>
      <div className="bg-muted/60 flex flex-wrap items-center justify-between gap-3 rounded-lg p-4">
        <p className="text-sm font-medium">{t('authSide.newHere')}</p>
        <Link
          href="/sign-up"
          className="border-foreground/15 bg-card hover:bg-accent inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-bold"
        >
          {t('auth.signUpTitle')}
        </Link>
      </div>
      <p className="text-muted-foreground text-center text-sm">
        <Link href="/play/tutorial" className="text-link underline">
          {t('landing.playGuest')}
        </Link>
      </p>
    </div>
  );
}
