import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { SignOutButton } from '@/components/auth/sign-out-button';
import type { AvatarConfig } from '@/lib/avatar/presets';

// Temporary landing spot after sign-in; the full dashboard is built in Phase 4.
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: profile } = await supabase
    .from('profiles')
    .select('username, avatar_config')
    .eq('id', claims?.claims.sub ?? '')
    .maybeSingle();

  return (
    <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="flex items-center gap-4">
        <BlockyAvatar config={profile?.avatar_config as Partial<AvatarConfig>} size={56} />
        <h1 className="text-3xl font-bold">{t('welcome', { name: profile?.username ?? '' })}</h1>
      </div>
      <p className="text-muted-foreground">{t('comingSoon')}</p>
      <SignOutButton />
    </main>
  );
}
