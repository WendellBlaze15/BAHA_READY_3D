/**
 * Query key factory (Section 15.1). Never use inline string keys.
 * Hierarchical so a whole area can be invalidated, e.g. qk.content.all().
 */
export const qk = {
  me: {
    all: () => ['me'] as const,
    profile: () => ['me', 'profile'] as const,
    settings: () => ['me', 'settings'] as const,
    progress: () => ['me', 'progress'] as const,
    achievements: () => ['me', 'achievements'] as const,
    tips: () => ['me', 'tips'] as const,
    streak: () => ['me', 'streak'] as const,
    attempts: (limit = 20) => ['me', 'attempts', limit] as const,
    groups: () => ['me', 'groups'] as const,
    application: () => ['me', 'application'] as const,
    factors: () => ['me', 'factors'] as const,
  },
  notifications: {
    all: () => ['notifications'] as const,
    list: () => ['notifications', 'list'] as const,
    unread: () => ['notifications', 'unread'] as const,
  },
  content: {
    all: () => ['content'] as const,
    tips: () => ['content', 'tips'] as const,
    hotlines: () => ['content', 'hotlines'] as const,
    items: () => ['content', 'items'] as const,
    tasks: () => ['content', 'tasks'] as const,
    hazards: () => ['content', 'hazards'] as const,
    npcs: () => ['content', 'npcs'] as const,
    achievements: () => ['content', 'achievements'] as const,
    levels: () => ['content', 'levels'] as const,
    levelVersion: (id: string) => ['content', 'level-version', id] as const,
  },
  leaderboard: {
    all: () => ['leaderboard'] as const,
    list: (scope: string, period: string, levelId?: number | null, groupId?: string | null) =>
      ['leaderboard', scope, period, levelId ?? null, groupId ?? null] as const,
    me: (scope: string, period: string, levelId?: number | null, groupId?: string | null) =>
      ['leaderboard', 'me', scope, period, levelId ?? null, groupId ?? null] as const,
  },
  daily: { today: () => ['daily', 'today'] as const },
  weather: { current: () => ['weather'] as const },
  groups: {
    all: () => ['groups'] as const,
    mine: () => ['groups', 'mine'] as const,
    detail: (id: string) => ['groups', id] as const,
    members: (id: string) => ['groups', id, 'members'] as const,
    assignments: (id: string) => ['groups', id, 'assignments'] as const,
    announcements: (id: string) => ['groups', id, 'announcements'] as const,
    progress: (id: string) => ['groups', id, 'progress'] as const,
    analytics: (id: string, filters: unknown) => ['groups', id, 'analytics', filters] as const,
  },
  facilitator: {
    dashboard: () => ['facilitator', 'dashboard'] as const,
    reports: () => ['facilitator', 'reports'] as const,
    liveSession: (id: string) => ['facilitator', 'live', id] as const,
  },
  admin: {
    all: () => ['admin'] as const,
    kpis: () => ['admin', 'kpis'] as const,
    users: (q: unknown) => ['admin', 'users', q] as const,
    user: (id: string) => ['admin', 'user', id] as const,
    applications: (status: string) => ['admin', 'applications', status] as const,
    content: (table: string) => ['admin', 'content', table] as const,
    levels: () => ['admin', 'levels'] as const,
    flagged: () => ['admin', 'flagged'] as const,
    audit: (q: unknown) => ['admin', 'audit', q] as const,
    settings: () => ['admin', 'settings'] as const,
    security: () => ['admin', 'security'] as const,
    emails: () => ['admin', 'emails'] as const,
  },
  system: { public: () => ['system', 'public'] as const },
} as const;
