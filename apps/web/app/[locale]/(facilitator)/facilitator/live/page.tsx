import { setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { LiveSessionPanel } from '@/components/facilitator/live-session';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub ?? '';
  const [{ data: levels }, { data: profile }] = await Promise.all([
    supabase.from('levels').select('id, name_fil, name_en').order('sort_order'),
    supabase.from('profiles').select('username').eq('id', uid).maybeSingle(),
  ]);
  return (
    <LiveSessionPanel
      levels={levels ?? []}
      me={{ id: uid, username: (profile?.username as string) ?? '' }}
    />
  );
}
