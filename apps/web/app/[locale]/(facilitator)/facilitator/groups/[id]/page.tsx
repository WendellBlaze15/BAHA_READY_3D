import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { GroupAdmin } from '@/components/facilitator/group-admin';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: group } = await supabase
    .from('groups')
    .select(
      'id, name, description, join_code, requires_approval, max_members, is_archived, facilitator_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (!group || group.facilitator_id !== claims?.claims.sub) notFound();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return <GroupAdmin initial={group} appUrl={`${appUrl}${locale === 'en' ? '/en' : ''}`} />;
}
