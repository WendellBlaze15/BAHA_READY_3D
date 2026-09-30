'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Loader2 } from 'lucide-react';
import { apiPost } from '@/lib/api/client';
import { useAuthTransition } from '@/lib/auth/auth-transition';
import { Button } from '@/components/ui/button';

export function SignOutButton({ scope = 'local' }: { scope?: 'local' | 'others' | 'global' }) {
  const t = useTranslations('auth');
  const authTransition = useAuthTransition();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      className="min-h-11"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await apiPost('/api/auth/signout', { scope });
        } finally {
          authTransition('/');
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      {t('signOut')}
    </Button>
  );
}
