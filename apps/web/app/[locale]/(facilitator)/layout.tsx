import { Suspense } from 'react';
import { AuthedShell } from '@/components/app-shell/authed-shell';

// Access (groups.manage + MFA) is enforced by middleware and, for data, by RLS.
export default function FacilitatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AuthedShell>
        <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8">{children}</div>
      </AuthedShell>
    </Suspense>
  );
}
