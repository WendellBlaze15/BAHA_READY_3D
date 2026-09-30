import { setRequestLocale } from 'next-intl/server';
import { AuditLogs } from '@/components/admin/audit-and-announcements';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AuditLogs />;
}
