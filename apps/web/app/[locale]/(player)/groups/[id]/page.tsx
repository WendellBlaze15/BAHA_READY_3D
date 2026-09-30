import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { GroupDetail } from '@/components/groups/group-detail';

export default async function GroupPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await getSupabaseServer();
  // RLS: only members (or the owner/admins) can read the group.
  const [{ data: group }, { data: levels }] = await Promise.all([
    supabase.from('groups').select('id, name, description').eq('id', id).maybeSingle(),
    supabase.from('levels').select('id, slug, name_fil, name_en').order('sort_order'),
  ]);
  if (!group) notFound();
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <GroupDetail group={group} levels={levels ?? []} />
    </div>
  );
}
