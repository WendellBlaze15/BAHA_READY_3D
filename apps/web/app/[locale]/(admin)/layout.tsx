import { Suspense } from 'react';
import { AuthedShell } from '@/components/app-shell/authed-shell';

// Access (content.manage + MFA) is enforced by middleware; every query/mutation is re-checked by RLS/RPC authorize().
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AuthedShell>
        <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">{children}</div>
      </AuthedShell>
    </Suspense>
  );
}
