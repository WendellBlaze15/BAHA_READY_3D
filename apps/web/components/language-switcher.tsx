'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import type { Locale } from '@/i18n/routing';

export function LanguageSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === 'fil' ? 'en' : 'fil';

  return (
    <Button
      variant="ghost"
      size="sm"
      className="min-h-11 gap-1.5"
      disabled={pending}
      aria-label={`${t('language')}: ${next === 'en' ? 'English' : 'Filipino'}`}
      onClick={() => startTransition(() => router.replace(pathname, { locale: next }))}
    >
      <Languages aria-hidden />
      {next === 'en' ? 'EN' : 'FIL'}
    </Button>
  );
}
