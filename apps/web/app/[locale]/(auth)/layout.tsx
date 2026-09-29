import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('common');
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
        <Link href="/" className="flex min-h-11 items-center gap-2">
          <BrandMark />
          <span className="font-display text-xl font-bold">{t('appName')}</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className="bg-card w-full max-w-md rounded-2xl border p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
