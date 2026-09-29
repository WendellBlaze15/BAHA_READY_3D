'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { apiPost } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

export function SignOutButton({ scope = 'local' }: { scope?: 'local' | 'others' | 'global' }) {
  const t = useTranslations('auth');
  const router = useRouter();
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
          router.replace('/');
          router.refresh();
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      {t('signOut')}
    </Button>
  );
}
