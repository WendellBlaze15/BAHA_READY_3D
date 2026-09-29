import type { AvatarConfig } from '@/lib/avatar/presets';
import { cn } from '@/lib/utils';

/**
 * Lightweight 2D front view of the blocky avatar (lists, leaderboards, onboarding).
 * The in-game avatar is the 3D version built from the same AvatarConfig.
 */
export function BlockyAvatar({
  config,
  size = 64,
  className,
  title,
}: {
  config: Partial<AvatarConfig> | null | undefined;
  size?: number;
  className?: string;
  title?: string;
}) {
  const c: AvatarConfig = {
    v: 1,
    skin: '#C68B59',
    hair: '#1B1B1B',
    hairStyle: 'short',
    shirt: '#2F6F7E',
    pants: '#1E2A38',
    shoes: '#F2EFEA',
    hat: null,
    accessory: null,
    face: 'smile',
    ...(config ?? {}),
  };
  const mouth =
    c.face === 'grin'
      ? 'M26 27 q6 5 12 0'
      : c.face === 'determined'
        ? 'M27 28 h10'
        : c.face === 'calm'
          ? 'M27 27.5 q5 2 10 0'
          : 'M26 27 q6 4 12 0';
  return (
    <svg
      viewBox="0 0 64 96"
      width={size}
      height={(size * 96) / 64}
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* legs */}
      <rect x="20" y="66" width="11" height="22" rx="1.5" fill={c.pants} />
      <rect x="33" y="66" width="11" height="22" rx="1.5" fill={c.pants} />
      <rect x="19" y="86" width="13" height="6" rx="1.5" fill={c.shoes} />
      <rect x="32" y="86" width="13" height="6" rx="1.5" fill={c.shoes} />
      {/* arms */}
      <rect x="8" y="40" width="10" height="26" rx="2" fill={c.skin} />
      <rect x="46" y="40" width="10" height="26" rx="2" fill={c.skin} />
      <rect x="8" y="40" width="10" height="12" rx="2" fill={c.shirt} />
      <rect x="46" y="40" width="10" height="12" rx="2" fill={c.shirt} />
      {/* torso */}
      <rect x="18" y="38" width="28" height="30" rx="2" fill={c.shirt} />
      {c.accessory === 'vest_reflective' && (
        <>
          <rect x="18" y="38" width="28" height="30" rx="2" fill="#F2C416" opacity="0.85" />
          <rect x="18" y="52" width="28" height="3" fill="#EEF2F3" />
        </>
      )}
      {c.accessory === 'apron' && (
        <rect x="22" y="46" width="20" height="22" rx="1.5" fill="#EEF2F3" />
      )}
      {c.accessory?.startsWith('backpack') && (
        <rect x="42" y="42" width="6" height="18" rx="1.5" fill="#1F3A93" />
      )}
      {/* head */}
      <rect x="17" y="8" width="30" height="30" rx="4" fill={c.skin} />
      {/* hair */}
      {c.hairStyle === 'long' && <rect x="15" y="6" width="34" height="26" rx="5" fill={c.hair} />}
      {c.hairStyle === 'bun' && <rect x="27" y="1" width="10" height="8" rx="3" fill={c.hair} />}
      {c.hairStyle !== 'buzz' && <rect x="17" y="6" width="30" height="9" rx="4" fill={c.hair} />}
      {c.hairStyle === 'buzz' && <rect x="17" y="7" width="30" height="5" rx="3" fill={c.hair} />}
      {c.hairStyle === 'long' && <rect x="21" y="14" width="22" height="22" rx="3" fill={c.skin} />}
      {/* face */}
      <rect x="24" y="19" width="4" height="5" rx="1" fill="#1E2A38" />
      <rect x="36" y="19" width="4" height="5" rx="1" fill="#1E2A38" />
      <path d={mouth} stroke="#1E2A38" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* hats */}
      {c.hat === 'cap_red' && (
        <>
          <rect x="16" y="4" width="32" height="9" rx="3" fill="#D2402F" />
          <rect x="30" y="11" width="22" height="3" rx="1.5" fill="#A93226" />
        </>
      )}
      {c.hat === 'helmet_yellow' && (
        <rect x="14" y="2" width="36" height="12" rx="5" fill="#F2C416" />
      )}
      {c.hat === 'salakot' && (
        <path d="M8 13 L32 0 L56 13 Z" fill="#C9A66B" stroke="#8A6B4A" strokeWidth="1.5" />
      )}
    </svg>
  );
}
