import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StatusPage } from '@/components/status-page';

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <StatusPage code="404" title={t('errors.notFoundTitle')} body={t('errors.notFoundBody')}>
      <Button asChild className="min-h-11">
        <Link href="/">{t('common.backHome')}</Link>
      </Button>
    </StatusPage>
  );
}
