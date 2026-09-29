import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StatusPage } from '@/components/status-page';
import { getSupabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function MaintenancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('errors');
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'maintenance')
    .maybeSingle();
  const v = (data?.value ?? {}) as { message_fil?: string; message_en?: string };
  const custom = locale === 'en' ? v.message_en : v.message_fil;
  return <StatusPage code="⚙" title="Maintenance" body={custom || t('maintenance')} />;
}
