'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown when a query fails, instead of leaving a skeleton up forever.
 * PostgREST 42501 (permission denied, e.g. missing aal2) gets the permission message.
 */
export function QueryError({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const t = useTranslations();
  const code = (error as { code?: string } | null)?.code;
  return (
    <div
      role="alert"
      className="bg-card flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-5"
    >
      <AlertTriangle className="text-signal-amber size-6 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {code === '42501' ? t('errors.forbidden') : t('errors.generic')}
      </p>
      <Button variant="outline" className="min-h-11" onClick={onRetry} disabled={retrying}>
        <RotateCw className={retrying ? 'animate-spin' : undefined} aria-hidden />
        {t('common.retry')}
      </Button>
    </div>
  );
}
