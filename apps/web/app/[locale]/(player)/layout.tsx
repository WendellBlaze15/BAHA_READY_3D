import { Suspense } from 'react';
import { AuthedShell } from '@/components/app-shell/authed-shell';

export default function PlayerLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AuthedShell>{children}</AuthedShell>
    </Suspense>
  );
}
