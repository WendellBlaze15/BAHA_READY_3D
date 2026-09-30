import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { JoinGroupForm } from '@/components/groups/join-group-form';
import { MyGroups } from '@/components/groups/my-groups';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('groupsPage');
  return { title: t('title') };
}

export default async function GroupsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { locale } = await params;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('groupsPage');
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('lede')}</p>
      </div>
      <JoinGroupForm initialCode={code ?? ''} />
      <MyGroups />
    </div>
  );
}
