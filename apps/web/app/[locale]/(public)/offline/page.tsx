import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { StatusPage } from '@/components/status-page';

export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  return (
    <StatusPage code="⟂" title={t('offline.title')} body={t('offline.body')}>
      <Button asChild className="min-h-11">
        <Link href="/">{t('common.backHome')}</Link>
      </Button>
    </StatusPage>
  );
}
