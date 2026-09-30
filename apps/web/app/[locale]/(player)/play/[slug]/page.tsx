import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { loadLevelBundle } from '@/lib/game/load-level';
import { GameRoot } from '@/game/GameRoot';
import { parsePlayContext, unlockedByContext } from '@/lib/game/context-unlock';
import type { AvatarConfig } from '@/lib/avatar/presets';

type Params = {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ mode?: string; session?: string; assignment?: string; sandbox?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, slug } = await params;
  const bundle = await loadLevelBundle(slug, locale === 'en' ? 'en' : 'fil');
  return { title: bundle?.level.name ?? 'Play', robots: { index: false } };
}

const GUEST_LEVELS = new Set(['tutorial', 'signal-1']);

export default async function PlayPage({ params, searchParams }: Params) {
  const { locale, slug } = await params;
  const q = await searchParams;
  const { sandbox } = q;
  const ctx = parsePlayContext(q);
  setRequestLocale(locale);
  const bundle = await loadLevelBundle(slug, locale === 'en' ? 'en' : 'fil');
  if (!bundle) notFound();

  const supabase = await getSupabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub;
  const guest = !uid;
  if (guest && !GUEST_LEVELS.has(slug)) redirect({ href: `/sign-in?next=/play/${slug}`, locale });

  let avatar: Partial<AvatarConfig> | null = null;
  let bestScore: number | null = null;
  let username: string | null = null;
  let settings = null;
  if (uid) {
    const [{ data: profile }, { data: prog }, { data: s }] = await Promise.all([
      supabase.from('profiles').select('avatar_config, username').eq('id', uid).maybeSingle(),
      supabase
        .from('player_level_progress')
        .select('best_score, unlocked')
        .eq('user_id', uid)
        .eq('level_id', bundle.level.id)
        .maybeSingle(),
      supabase
        .from('user_settings')
        .select('graphics_quality, audio, controls, reduced_motion')
        .eq('user_id', uid)
        .maybeSingle(),
    ]);
    avatar = (profile?.avatar_config as Partial<AvatarConfig>) ?? null;
    username = (profile?.username as string) ?? null;
    bestScore = prog?.best_score ?? null;
    settings = s;
    if (
      bundle.level.id > 1 &&
      !prog?.unlocked &&
      !(await unlockedByContext(supabase, uid, bundle.level.id, ctx))
    )
      redirect({ href: '/levels?locked=1', locale });
  }

  return (
    <GameRoot
      level={bundle.level}
      config={bundle.config}
      content={bundle.content}
      texts={bundle.texts}
      avatar={avatar}
      guest={guest}
      bestScore={bestScore}
      nextHref={bundle.nextSlug ? `/play/${bundle.nextSlug}` : null}
      tips={bundle.tips}
      settings={settings as never}
      mode={ctx.mode}
      liveSessionId={ctx.liveSessionId}
      assignmentId={ctx.assignmentId}
      sandbox={
        sandbox === '1' &&
        ((claims?.claims as { permissions?: string[] } | undefined)?.permissions ?? []).includes(
          'content.manage',
        )
      }
      me={uid ? { id: uid, username: username ?? '' } : undefined}
    />
  );
}
