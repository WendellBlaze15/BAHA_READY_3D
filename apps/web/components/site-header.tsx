import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { getClaims } from '@/lib/auth/session';
import { homeFor } from '@/lib/auth/claims';

export async function SiteHeader() {
  const t = await getTranslations();
  const claims = await getClaims();
  return (
    <header className="bg-card/95 supports-[backdrop-filter]:bg-card/80 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 pt-[env(safe-area-inset-top)]">
        <Link href="/" className="flex min-h-11 items-center gap-2 rounded-sm">
          <BrandMark />
          <span className="font-display text-xl font-bold tracking-tight">
            {t('common.appName')}
          </span>
        </Link>
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          <Button asChild variant="ghost" size="sm" className="min-h-11">
            <Link href="/tips">{t('nav.tips')}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="min-h-11">
            <Link href="/hotlines">{t('nav.hotlines')}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="min-h-11">
            <Link href="/about">{t('nav.about')}</Link>
          </Button>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
          <Button asChild size="sm" className="ml-1 min-h-11">
            {claims ? (
              <Link href={homeFor(claims)}>{t('nav.openApp')}</Link>
            ) : (
              <Link href="/sign-in">{t('nav.signIn')}</Link>
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
