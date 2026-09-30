import { setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { AssignmentsManager } from '@/components/facilitator/assignments-manager';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const supabase = await getSupabaseServer();
  const { data: levels } = await supabase
    .from('levels')
    .select('id, name_fil, name_en')
    .order('sort_order');
  return <AssignmentsManager levels={levels ?? []} />;
}
