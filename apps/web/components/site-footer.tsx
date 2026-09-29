import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export async function SiteFooter() {
  const t = await getTranslations();
  return (
    <footer className="text-muted-foreground mt-16 border-t pb-[env(safe-area-inset-bottom)] text-sm">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p>{t('footer.privacyNotice')}</p>
          <p>{t('footer.verifyNotice')}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link className="hover:text-foreground underline" href="/about">
            {t('nav.about')}
          </Link>
          <Link className="hover:text-foreground underline" href="/privacy">
            {t('nav.privacy')}
          </Link>
          <Link className="hover:text-foreground underline" href="/terms">
            {t('nav.terms')}
          </Link>
          <Link className="hover:text-foreground underline" href="/hotlines">
            {t('nav.hotlines')}
          </Link>
        </nav>
      </div>
    </footer>
  );
}
