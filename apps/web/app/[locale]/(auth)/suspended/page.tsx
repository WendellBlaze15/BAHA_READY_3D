import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SignOutButton } from '@/components/auth/sign-out-button';

export default async function SuspendedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('account');
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold">{t('suspendedTitle')}</h1>
      <p className="text-muted-foreground">{t('suspendedBody')}</p>
      <SignOutButton />
    </div>
  );
}
