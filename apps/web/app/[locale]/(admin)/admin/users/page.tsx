import { setRequestLocale } from 'next-intl/server';
import { UsersAdmin } from '@/components/admin/users-admin';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <UsersAdmin />;
}
