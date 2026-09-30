'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Bell, Menu } from 'lucide-react';
import { toast } from 'sonner';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { AppClaims } from '@/lib/auth/claims';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';
import {
  useProfile,
  useSettings,
  useUnreadCount,
  type ProfileRow,
  type SettingsRow,
} from '@/lib/data/me';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { BrandMark } from '@/components/brand-mark';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { PRIMARY_TABS, isActive, sectionsFor, type NavSection } from './nav-config';
import { SettingsApplier } from './settings-applier';
import { OfflineSync } from '@/lib/offline/offline-sync';
import { UserMenu } from './user-menu';

export function ShellClient({
  claims,
  profile: initialProfile,
  settings: initialSettings,
  groupIds,
  children,
}: {
  claims: AppClaims;
  profile: ProfileRow | null;
  settings: SettingsRow | null;
  groupIds: string[];
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: profile } = useProfile(initialProfile);
  useSettings(initialSettings);
  const sections = sectionsFor(claims);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (params.get('denied') === '1') toast.error(t('account.deniedToast'));
  }, [params, t]);

  // The game route is full-screen: no chrome.
  const immersive = pathname.startsWith('/play/');

  return (
    <RealtimeProvider userId={claims.sub} groupIds={groupIds}>
      <OfflineSync />
      <SettingsApplier />
      {immersive ? (
        children
      ) : (
        <div className="flex min-h-dvh">
          <aside
            aria-label={t('nav.sidebar')}
            className="bg-card sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r lg:flex"
          >
            <Link href="/home" className="flex h-16 items-center gap-2 px-5">
              <BrandMark />
              <span className="font-display text-xl font-bold">{t('common.appName')}</span>
            </Link>
            <div className="flex-1 overflow-y-auto px-3 pb-6">
              <SidebarSections sections={sections} pathname={pathname} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky top-0 z-30 border-b pt-[env(safe-area-inset-top)] backdrop-blur">
              <div className="flex h-14 items-center gap-1 px-3 sm:px-4">
                <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 lg:hidden"
                      aria-label={t('nav.openMenu')}
                    >
                      <Menu aria-hidden />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-72 overflow-y-auto p-0">
                    <SheetHeader className="px-5 pt-5">
                      <SheetTitle className="font-display flex items-center gap-2 text-xl">
                        <BrandMark /> {t('common.appName')}
                      </SheetTitle>
                    </SheetHeader>
                    <div className="px-3 pb-8">
                      <SidebarSections sections={sections} pathname={pathname} />
                    </div>
                  </SheetContent>
                </Sheet>
                <Link
                  href="/home"
                  className="flex items-center gap-2 lg:hidden"
                  aria-label={t('common.appName')}
                >
                  <BrandMark className="size-7" />
                </Link>
                <div className="ml-auto flex items-center gap-1">
                  <LanguageSwitcher />
                  <ThemeToggle />
                  <NotificationBell />
                  <UserMenu
                    username={profile?.username ?? ''}
                    avatar={
                      <BlockyAvatar
                        config={profile?.avatar_config as Partial<AvatarConfig>}
                        size={22}
                      />
                    }
                  />
                </div>
              </div>
            </header>
            <main id="main" className="pb-tabbar min-w-0 flex-1">
              {children}
            </main>
          </div>

          <nav
            aria-label={t('nav.tabs')}
            className="bg-card fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
          >
            <ul className="grid grid-cols-5">
              {PRIMARY_TABS.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-bold',
                        active ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                          active && 'bg-accent',
                        )}
                      >
                        <Icon className="size-5" aria-hidden />
                      </span>
                      {t(item.labelKey as never)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      )}
    </RealtimeProvider>
  );
}

function SidebarSections({ sections, pathname }: { sections: NavSection[]; pathname: string }) {
  const t = useTranslations();
  return (
    <nav className="space-y-5">
      {sections.map((s) => (
        <div key={s.titleKey}>
          <p className="text-muted-foreground px-3 pb-1 text-xs font-bold">
            {t(s.titleKey as never)}
          </p>
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm',
                      active
                        ? 'bg-accent text-foreground font-bold'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4.5" aria-hidden />
                    {t(item.labelKey as never)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NotificationBell() {
  const t = useTranslations('nav');
  const { data: unread = 0 } = useUnreadCount();
  return (
    <Button asChild variant="ghost" size="icon" className="relative size-11">
      <Link href="/notifications" aria-label={t('notificationsCount', { count: unread })}>
        <Bell aria-hidden />
        {unread > 0 && (
          <span className="bg-signal-red absolute top-1.5 right-1.5 flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] leading-5 font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
