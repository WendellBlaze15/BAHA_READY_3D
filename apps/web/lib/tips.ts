export type UnlockRule =
  { type: 'always' } | { type: 'mistake'; key: string } | { type: 'level_complete'; level: number };

export function parseUnlockRule(v: unknown): UnlockRule {
  const r = (v ?? {}) as Record<string, unknown>;
  if (r.type === 'mistake' && typeof r.key === 'string') return { type: 'mistake', key: r.key };
  if (r.type === 'level_complete' && typeof r.level === 'number')
    return { type: 'level_complete', level: r.level };
  return { type: 'always' };
}

export const TIP_CATEGORIES = [
  'before',
  'during',
  'after',
  'gobag',
  'home',
  'evacuation',
  'health',
  'electricity',
  'community',
] as const;
