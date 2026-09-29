'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StatusPage } from '@/components/status-page';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <StatusPage code="!" tone="danger" title={t('errors.errorTitle')} body={t('errors.errorBody')}>
      <Button onClick={reset} className="min-h-11">
        {t('common.retry')}
      </Button>
      <Button asChild variant="outline" className="min-h-11">
        <Link href="/">{t('common.backHome')}</Link>
      </Button>
    </StatusPage>
  );
}
