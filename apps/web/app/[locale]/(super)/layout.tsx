import { Suspense } from 'react';
import { AuthedShell } from '@/components/app-shell/authed-shell';

// Access (super_admin + system.manage + MFA) is enforced by middleware and re-checked server-side.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AuthedShell>
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</div>
      </AuthedShell>
    </Suspense>
  );
}
