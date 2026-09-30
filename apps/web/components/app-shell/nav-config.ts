import {
  Award,
  BarChart3,
  Bell,
  BookOpen,
  ClipboardList,
  FileText,
  Flag,
  Gauge,
  Home,
  KeyRound,
  LayoutDashboard,
  Map,
  Megaphone,
  Radio,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Shirt,
  Trophy,
  User,
  Users,
  UserPlus,
  Wrench,
  Layers,
  ServerCog,
  Siren,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hasPermission, type AppClaims, type Permission } from '@/lib/auth/claims';

export type NavItem = { href: string; labelKey: string; icon: LucideIcon; exact?: boolean };
export type NavSection = { titleKey: string; items: NavItem[] };

/** Bottom tab bar on phones (Section 17.1). */
export const PRIMARY_TABS: NavItem[] = [
  { href: '/home', labelKey: 'nav.home', icon: Home },
  { href: '/levels', labelKey: 'nav.levels', icon: Map },
  { href: '/leaderboard', labelKey: 'nav.leaderboard', icon: Trophy },
  { href: '/groups', labelKey: 'nav.groups', icon: Users },
  { href: '/profile', labelKey: 'nav.profile', icon: User },
];

const PLAYER_MORE: NavItem[] = [
  { href: '/achievements', labelKey: 'nav.achievements', icon: Award },
  { href: '/avatar', labelKey: 'nav.avatar', icon: Shirt },
  { href: '/tips', labelKey: 'nav.tips', icon: BookOpen },
  { href: '/hotlines', labelKey: 'nav.hotlines', icon: Siren },
  { href: '/notifications', labelKey: 'nav.notifications', icon: Bell },
  { href: '/settings', labelKey: 'nav.settings', icon: Settings },
  { href: '/live', labelKey: 'nav.joinLive', icon: Radio },
];

const APPLY: NavItem = { href: '/apply', labelKey: 'nav.apply', icon: UserPlus };

const FACILITATOR: NavItem[] = [
  { href: '/facilitator', labelKey: 'nav.facDashboard', icon: LayoutDashboard, exact: true },
  { href: '/facilitator/groups', labelKey: 'nav.facGroups', icon: Users },
  { href: '/facilitator/assignments', labelKey: 'nav.facAssignments', icon: ClipboardList },
  { href: '/facilitator/live', labelKey: 'nav.facLive', icon: Radio },
  { href: '/facilitator/analytics', labelKey: 'nav.facAnalytics', icon: BarChart3 },
  { href: '/facilitator/reports', labelKey: 'nav.facReports', icon: FileText },
];

const ADMIN: NavItem[] = [
  { href: '/admin', labelKey: 'nav.adminDashboard', icon: Gauge, exact: true },
  { href: '/admin/users', labelKey: 'nav.adminUsers', icon: Users },
  { href: '/admin/applications', labelKey: 'nav.adminApplications', icon: UserPlus },
  { href: '/admin/content', labelKey: 'nav.adminContent', icon: Layers },
  { href: '/admin/levels', labelKey: 'nav.adminLevels', icon: Wrench },
  { href: '/admin/moderation', labelKey: 'nav.adminModeration', icon: Flag },
  { href: '/admin/announcements', labelKey: 'nav.adminAnnouncements', icon: Megaphone },
  { href: '/admin/audit', labelKey: 'nav.adminAudit', icon: ScrollText },
];

const SUPER: NavItem[] = [
  { href: '/super', labelKey: 'nav.superConsole', icon: ShieldCheck, exact: true },
  { href: '/super/admins', labelKey: 'nav.superAdmins', icon: KeyRound },
  { href: '/super/system', labelKey: 'nav.superSystem', icon: ServerCog },
  { href: '/super/security', labelKey: 'nav.superSecurity', icon: Shield },
];

export function sectionsFor(claims: AppClaims): NavSection[] {
  const can = (p: Permission) => hasPermission(claims, p);
  const play = [...PRIMARY_TABS, ...PLAYER_MORE];
  if (!can('groups.manage') && claims.user_role === 'player') play.push(APPLY);
  const sections: NavSection[] = [{ titleKey: 'nav.sectionPlay', items: play }];
  if (can('groups.manage'))
    sections.push({ titleKey: 'nav.sectionFacilitator', items: FACILITATOR });
  if (can('content.manage')) sections.push({ titleKey: 'nav.sectionAdmin', items: ADMIN });
  if (claims.user_role === 'super_admin')
    sections.push({ titleKey: 'nav.sectionSuper', items: SUPER });
  return sections;
}

export function isActive(pathname: string, item: NavItem) {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
