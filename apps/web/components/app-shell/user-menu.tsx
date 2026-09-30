'use client';

import { useTranslations } from 'next-intl';
import { LogOut, Settings, User } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { apiPost } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { useAuthTransition } from '@/lib/auth/auth-transition';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu({ username, avatar }: { username: string; avatar: React.ReactNode }) {
  const t = useTranslations();
  const authTransition = useAuthTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="size-11 p-0" aria-label={t('nav.accountMenu')}>
          {avatar}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate">@{username}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User aria-hidden /> {t('nav.profile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden /> {t('nav.settings')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await apiPost('/api/auth/signout', {});
            } finally {
              authTransition('/');
            }
          }}
        >
          <LogOut aria-hidden /> {t('auth.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
