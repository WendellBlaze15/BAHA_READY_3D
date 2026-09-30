'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { TIP_CATEGORIES } from '@/lib/tips';
import { SafeMarkdown } from '@/components/tips/markdown';
import { SkeletonTableRow } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type Field = {
  name: string;
  type: 'text' | 'textarea' | 'markdown' | 'number' | 'switch' | 'select' | 'json';
  lang?: 'fil' | 'en';
  options?: readonly string[];
  required?: boolean;
};
type TableName = 'tips' | 'hotlines' | 'gobag_items' | 'home_tasks' | 'hazards' | 'npc_types';

const ITEM_CATS = [
  'water',
  'food',
  'light',
  'health',
  'communication',
  'documents',
  'clothing',
  'hygiene',
  'money',
  'tools',
  'pet',
  'non_essential',
] as const;

// DECISION: one schema-driven editor for all six content tables keeps validation and the
// bilingual tab UX consistent; the database CHECK constraints remain the source of truth.
const SPECS: Record<TableName, { list: string[]; fields: Field[]; order: string }> = {
  tips: {
    order: 'sort_order',
    list: ['slug', 'title_fil', 'category', 'is_published'],
    fields: [
      { name: 'slug', type: 'text', required: true },
      { name: 'category', type: 'select', options: TIP_CATEGORIES },
      { name: 'sort_order', type: 'number' },
      { name: 'is_published', type: 'switch' },
      { name: 'needs_verification', type: 'switch' },
      { name: 'unlock_rule', type: 'json' },
      { name: 'title_fil', type: 'text', lang: 'fil', required: true },
      { name: 'body_fil', type: 'markdown', lang: 'fil', required: true },
      { name: 'title_en', type: 'text', lang: 'en', required: true },
      { name: 'body_en', type: 'markdown', lang: 'en', required: true },
    ],
  },
  hotlines: {
    order: 'sort_order',
    list: ['agency', 'number', 'area', 'is_verified', 'is_active'],
    fields: [
      { name: 'agency', type: 'text', required: true },
      { name: 'number', type: 'text', required: true },
      { name: 'area', type: 'text' },
      { name: 'sort_order', type: 'number' },
      { name: 'is_verified', type: 'switch' },
      { name: 'is_active', type: 'switch' },
    ],
  },
  gobag_items: {
    order: 'sort_order',
    list: ['key', 'name_fil', 'weight_kg', 'is_essential', 'points', 'is_published'],
    fields: [
      { name: 'key', type: 'text', required: true },
      { name: 'category', type: 'select', options: ITEM_CATS },
      { name: 'weight_kg', type: 'number' },
      { name: 'points', type: 'number' },
      { name: 'is_essential', type: 'switch' },
      { name: 'is_published', type: 'switch' },
      { name: 'model_key', type: 'text' },
      { name: 'sort_order', type: 'number' },
      { name: 'name_fil', type: 'text', lang: 'fil', required: true },
      { name: 'explanation_fil', type: 'textarea', lang: 'fil', required: true },
      { name: 'name_en', type: 'text', lang: 'en', required: true },
      { name: 'explanation_en', type: 'textarea', lang: 'en', required: true },
    ],
  },
  home_tasks: {
    order: 'sort_order',
    list: ['key', 'name_fil', 'points', 'is_published'],
    fields: [
      { name: 'key', type: 'text', required: true },
      { name: 'points', type: 'number' },
      { name: 'sort_order', type: 'number' },
      { name: 'is_published', type: 'switch' },
      { name: 'name_fil', type: 'text', lang: 'fil', required: true },
      { name: 'explanation_fil', type: 'textarea', lang: 'fil', required: true },
      { name: 'name_en', type: 'text', lang: 'en', required: true },
      { name: 'explanation_en', type: 'textarea', lang: 'en', required: true },
    ],
  },
  hazards: {
    order: 'key',
    list: ['key', 'name_fil', 'penalty', 'instant_fail', 'is_published'],
    fields: [
      { name: 'key', type: 'text', required: true },
      { name: 'penalty', type: 'number' },
      { name: 'instant_fail', type: 'switch' },
      { name: 'is_published', type: 'switch' },
      { name: 'name_fil', type: 'text', lang: 'fil', required: true },
      { name: 'explanation_fil', type: 'textarea', lang: 'fil', required: true },
      { name: 'name_en', type: 'text', lang: 'en', required: true },
      { name: 'explanation_en', type: 'textarea', lang: 'en', required: true },
    ],
  },
  npc_types: {
    order: 'key',
    list: ['key', 'name_fil', 'points', 'is_published'],
    fields: [
      { name: 'key', type: 'text', required: true },
      { name: 'points', type: 'number' },
      { name: 'needs', type: 'json' },
      { name: 'is_published', type: 'switch' },
      { name: 'name_fil', type: 'text', lang: 'fil', required: true },
      { name: 'name_en', type: 'text', lang: 'en', required: true },
    ],
  },
};

type Row = Record<string, unknown> & { id: string };

export function ContentCms() {
  const t = useTranslations('admin');
  const [table, setTable] = useState<TableName>('tips');
  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-bold">{t('contentTitle')}</h1>
      <div role="tablist" className="bg-muted flex flex-wrap gap-1 rounded-lg p-1">
        {(Object.keys(SPECS) as TableName[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={table === k}
            onClick={() => setTable(k)}
            className={`min-h-10 rounded-md px-3 text-sm font-bold ${table === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <ContentTable key={table} table={table} />
    </div>
  );
}

function ContentTable({ table }: { table: TableName }) {
  const t = useTranslations('admin');
  const qc = useQueryClient();
  const spec = SPECS[table];
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const { data, isPending } = useQuery({
    queryKey: qk.admin.content(table),
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser().from(table).select('*').order(spec.order);
      if (error) throw error;
      return data as unknown as Row[];
    },
    staleTime: 10_000,
  });

  const remove = async (row: Row) => {
    if (!confirm(t('removeConfirm'))) return;
    const prev = qc.getQueryData<Row[]>(qk.admin.content(table));
    qc.setQueryData<Row[]>(qk.admin.content(table), (r) => r?.filter((x) => x.id !== row.id));
    const { error } = await getSupabaseBrowser().from(table).delete().eq('id', row.id);
    if (error) {
      qc.setQueryData(qk.admin.content(table), prev);
      toast.error(error.message);
    }
  };

  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing('new')} className="min-h-11">
        <Plus aria-hidden /> {t('add')}
      </Button>
      <div className="bg-card overflow-x-auto rounded-lg border">
        {isPending ? (
          Array.from({ length: 6 }, (_, i) => (
            <SkeletonTableRow key={i} cols={spec.list.length + 1} />
          ))
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                {spec.list.map((c) => (
                  <th key={c} className="p-3 whitespace-nowrap">
                    {c}
                  </th>
                ))}
                <th className="p-3">
                  <span className="sr-only">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data ?? []).map((row) => (
                <tr key={row.id}>
                  {spec.list.map((c) => (
                    <td key={c} className="max-w-64 truncate p-3">
                      {typeof row[c] === 'boolean' ? (row[c] ? '✓' : '—') : String(row[c] ?? '')}
                    </td>
                  ))}
                  <td className="p-2 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10"
                      aria-label={t('edit')}
                      onClick={() => setEditing(row)}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10"
                      aria-label={t('remove')}
                      onClick={() => void remove(row)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Editor table={table} row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Editor({
  table,
  row,
  onClose,
}: {
  table: TableName;
  row: Row | 'new' | null;
  onClose: () => void;
}) {
  const t = useTranslations('admin');
  const qc = useQueryClient();
  const spec = SPECS[table];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!row) return;
    if (row === 'new') {
      const init: Record<string, unknown> = {};
      for (const f of spec.fields)
        init[f.name] =
          f.type === 'switch'
            ? f.name !== 'instant_fail' && f.name !== 'is_essential'
            : f.type === 'number'
              ? 0
              : f.type === 'json'
                ? {}
                : f.options
                  ? f.options[0]
                  : '';
      setValues(init);
    } else setValues({ ...row });
    setErrors({});
  }, [row, spec.fields]);

  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }));
  const common = spec.fields.filter((f) => !f.lang);
  const byLang = (l: 'fil' | 'en') => spec.fields.filter((f) => f.lang === l);

  async function save() {
    const errs: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    for (const f of spec.fields) {
      let v = values[f.name];
      if (f.type === 'json' && typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          errs[f.name] = 'JSON';
          continue;
        }
      }
      if (f.type === 'number') v = Number(v);
      if (f.required && (v === '' || v === undefined || v === null)) errs[f.name] = '!';
      payload[f.name] = v;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const sb = getSupabaseBrowser();
    const q =
      row === 'new'
        ? sb.from(table).insert(payload as never)
        : sb
            .from(table)
            .update(payload as never)
            .eq('id', (row as Row).id);
    const { error } = await q;
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t('saved'));
    void qc.invalidateQueries({ queryKey: qk.admin.content(table) });
    onClose();
  }

  const renderField = (f: Field) => {
    const id = `f-${f.name}`;
    const v = values[f.name];
    const invalid = !!errors[f.name];
    switch (f.type) {
      case 'switch':
        return (
          <div key={f.name} className="flex min-h-11 items-center justify-between gap-3">
            <Label htmlFor={id}>{f.name}</Label>
            <Switch id={id} checked={!!v} onCheckedChange={(c) => set(f.name, c)} />
          </div>
        );
      case 'select':
        return (
          <div key={f.name} className="space-y-1.5">
            <Label>{f.name}</Label>
            <Select value={String(v ?? '')} onValueChange={(x) => set(f.name, x)}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options!.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case 'textarea':
      case 'json':
        return (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={id}>{f.name}</Label>
            <Textarea
              id={id}
              rows={f.type === 'json' ? 3 : 4}
              aria-invalid={invalid || undefined}
              className={f.type === 'json' ? 'font-mono text-xs' : ''}
              value={
                f.type === 'json' && typeof v !== 'string'
                  ? JSON.stringify(v ?? {}, null, 0)
                  : String(v ?? '')
              }
              onChange={(e) => set(f.name, e.target.value)}
            />
          </div>
        );
      case 'markdown':
        return (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={id}>{f.name}</Label>
            <Textarea
              id={id}
              rows={8}
              aria-invalid={invalid || undefined}
              value={String(v ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            />
            <p className="text-muted-foreground text-xs">{t('preview')}</p>
            <div className="bg-muted max-h-48 overflow-y-auto rounded-lg p-3 text-sm [&_div]:text-base">
              <SafeMarkdown>{String(v ?? '')}</SafeMarkdown>
            </div>
          </div>
        );
      default:
        return (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={id}>{f.name}</Label>
            <Input
              id={id}
              type={f.type === 'number' ? 'number' : 'text'}
              step="any"
              aria-invalid={invalid || undefined}
              className="h-11"
              value={String(v ?? '')}
              onChange={(e) => set(f.name, e.target.value)}
            />
          </div>
        );
    }
  };

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {row === 'new' ? t('add') : t('edit')} · {t(`tabs.${table}`)}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-8">
          <div className="grid gap-3 sm:grid-cols-2">{common.map(renderField)}</div>
          {byLang('fil').length > 0 && (
            <Tabs defaultValue="fil">
              <TabsList className="grid h-11 w-full grid-cols-2">
                <TabsTrigger value="fil">{t('filipino')}</TabsTrigger>
                <TabsTrigger value="en">{t('english')}</TabsTrigger>
              </TabsList>
              <TabsContent value="fil" className="space-y-3 pt-3">
                {byLang('fil').map(renderField)}
              </TabsContent>
              <TabsContent value="en" className="space-y-3 pt-3">
                {byLang('en').map(renderField)}
              </TabsContent>
            </Tabs>
          )}
          <Button
            onClick={() => void save()}
            disabled={busy}
            className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 w-full font-bold"
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />} {t('save')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
