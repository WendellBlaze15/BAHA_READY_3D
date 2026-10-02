'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { survivalConfigSchema } from '@baha/shared/survival';
import { apiPost } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useApiErrorText } from '@/components/auth/use-api-error';
import { SkeletonCard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Version = {
  id: string;
  version: number;
  is_current: boolean;
  notes: string | null;
  published_at: string;
  config: Json;
};

const SECTIONS = [
  'difficulties',
  'stats',
  'session',
  'bag',
  'items',
  'recipes',
  'boatStages',
  'campUpgrades',
  'roles',
  'melee',
  'actions',
  'camera',
  'events',
  'hazards',
  'chat',
  'scoring',
  'survivors',
] as const;

/** Flattens to path → JSON value for the diff view. */
function flatten(v: Json, p = '', out: Record<string, string> = {}) {
  if (v && typeof v === 'object') {
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v);
    if (!entries.length) out[p] = JSON.stringify(v);
    for (const [k, x] of entries) flatten(x as Json, p ? `${p}.${k}` : k, out);
  } else out[p] = JSON.stringify(v);
  return out;
}

const setAt = (root: Json, path: (string | number)[], value: Json): Json => {
  if (!path.length) return value;
  const [h, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = [...root];
    copy[h as number] = setAt(copy[h as number] as Json, rest, value);
    return copy;
  }
  const obj = { ...(root as Record<string, Json>) };
  obj[h as string] = setAt(obj[h as string] as Json, rest, value);
  return obj;
};

/** Form for any JSON value (numbers, switches, text, lists, nested objects) — no raw JSON. */
function Field({
  label,
  value,
  path,
  onChange,
  errors,
}: {
  label: string;
  value: Json;
  path: (string | number)[];
  onChange: (path: (string | number)[], v: Json) => void;
  errors: Set<string>;
}) {
  const t = useTranslations('survivalAdmin.config');
  const key = path.join('.');
  const bad = errors.has(key);
  const id = `cfg-${key}`;
  if (typeof value === 'number')
    return (
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <Input
          id={id}
          type="number"
          step="any"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(path, e.target.value === '' ? 0 : Number(e.target.value))}
          className={cn('h-8 w-28 shrink-0', bad && 'border-destructive')}
        />
      </label>
    );
  if (typeof value === 'boolean')
    return (
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <Switch id={id} checked={value} onCheckedChange={(v) => onChange(path, v)} />
      </label>
    );
  if (typeof value === 'string' || value === null)
    return (
      <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <Input
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(path, e.target.value)}
          className={cn('h-8 w-56 shrink-0', bad && 'border-destructive')}
        />
      </label>
    );
  if (Array.isArray(value)) {
    const primitive = value.every((x) => typeof x !== 'object' || x === null);
    if (primitive)
      return (
        <label htmlFor={id} className="block text-sm">
          <span>{label}</span>
          <Input
            id={id}
            value={value.join(', ')}
            onChange={(e) => {
              const parts = e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean);
              const numeric =
                value.length > 0
                  ? typeof value[0] === 'number'
                  : parts.every((x) => !Number.isNaN(Number(x)));
              onChange(
                path,
                parts.map((x) => (numeric ? Number(x) : x)),
              );
            }}
            className={cn('mt-1 h-8', bad && 'border-destructive')}
          />
        </label>
      );
    return (
      <details className={cn('rounded-md border p-2', bad && 'border-destructive')}>
        <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium">
          <ChevronDown className="size-4" aria-hidden /> {label} ({value.length})
        </summary>
        <div className="mt-2 space-y-2">
          {value.map((item, i) => {
            const name =
              (item as { key?: string; level?: number; stage?: number })?.key ?? `#${i + 1}`;
            return (
              <div key={i} className="bg-muted/40 rounded-md p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold">{String(name)}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`${t('remove')} ${String(name)}`}
                    onClick={() =>
                      onChange(
                        path,
                        value.filter((_, k) => k !== i),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <Field
                  label={String(name)}
                  value={item}
                  path={[...path, i]}
                  onChange={onChange}
                  errors={errors}
                />
              </div>
            );
          })}
          {value.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange(path, [...value, structuredClone(value[value.length - 1]!)])}
            >
              <Plus aria-hidden /> {t('add')}
            </Button>
          )}
        </div>
      </details>
    );
  }
  return (
    <div className="space-y-1.5">
      {Object.entries(value).map(([k, v]) => (
        <div
          key={k}
          className={cn(
            typeof v === 'object' && v !== null && !Array.isArray(v) && 'border-l-2 pl-2',
          )}
        >
          {typeof v === 'object' && v !== null && !Array.isArray(v) && (
            <p className="text-xs font-semibold uppercase opacity-70">{k}</p>
          )}
          <Field label={k} value={v} path={[...path, k]} onChange={onChange} errors={errors} />
        </div>
      ))}
    </div>
  );
}

export function SurvivalConfigEditor() {
  const t = useTranslations('survivalAdmin.config');
  const errText = useApiErrorText();
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: ['admin', 'survival', 'config'],
    queryFn: async () => {
      const { data, error } = await getSupabaseBrowser()
        .from('survival_config_versions')
        .select('id, version, is_current, notes, published_at, config')
        .order('version', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as unknown as Version[];
    },
  });
  const current = versions.data?.find((v) => v.is_current);
  const [draft, setDraft] = useState<Json | null>(null);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('difficulties');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const working = draft ?? current?.config ?? null;

  const validation = useMemo(
    () => (working ? survivalConfigSchema.safeParse(working) : null),
    [working],
  );
  const errors = useMemo(
    () =>
      new Set(
        validation && !validation.success
          ? validation.error.issues.map((i) => i.path.join('.'))
          : [],
      ),
    [validation],
  );
  const diff = useMemo(() => {
    if (!current || !draft) return [];
    const a = flatten(current.config);
    const b = flatten(draft);
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((k) => a[k] !== b[k])
      .slice(0, 200)
      .map((k) => ({ k, from: a[k], to: b[k] }));
  }, [current, draft]);

  if (versions.isPending) return <SkeletonCard />;
  if (!working) return <p>{t('noChanges')}</p>;

  const publish = async () => {
    setBusy(true);
    try {
      const r = await apiPost<{ version: number }>('/api/admin/survival/config', {
        config: draft,
        notes,
      });
      toast.success(t('published', { version: r.version }));
      setDraft(null);
      setNotes('');
      void qc.invalidateQueries({ queryKey: ['admin', 'survival', 'config'] });
    } catch (e) {
      toast.error(errText(e));
    }
    setBusy(false);
  };

  const sectionValue = (working as Record<string, Json>)[section];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="bg-card min-w-0 space-y-3 rounded-lg border p-4">
        <p className="text-sm font-semibold">{t('current', { version: current?.version ?? 0 })}</p>
        <p className="text-muted-foreground text-xs">{t('pinned')}</p>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {SECTIONS.map((s) => (
            <Button
              key={s}
              size="xs"
              variant={section === s ? 'default' : 'outline'}
              role="tab"
              aria-selected={section === s}
              onClick={() => setSection(s)}
            >
              {t(`section.${s}`)}
              {[...errors].some((e) => e.startsWith(s)) && (
                <span className="bg-destructive ml-1 size-1.5 rounded-full" aria-hidden />
              )}
            </Button>
          ))}
        </div>
        {sectionValue !== undefined && (
          <Field
            label={section}
            value={sectionValue}
            path={[section]}
            onChange={(p, v) => setDraft(setAt(working, p, v))}
            errors={errors}
          />
        )}
      </section>

      <aside className="min-w-0 space-y-3">
        <section className="bg-card space-y-2 rounded-lg border p-4">
          <h3 className="font-semibold">{t('diff')}</h3>
          {diff.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noChanges')}</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-xs">
              {diff.map((d) => (
                <li key={d.k} className="break-all">
                  <span className="font-semibold">{d.k}</span>:{' '}
                  <span className="text-red-600 line-through">{d.from ?? '∅'}</span> →{' '}
                  <span className="text-emerald-700">{d.to ?? '∅'}</span>
                </li>
              ))}
            </ul>
          )}
          {validation && !validation.success && (
            <div role="alert" className="text-destructive text-xs">
              <p className="font-semibold">{t('invalid')}</p>
              <ul className="list-disc pl-4">
                {validation.error.issues.slice(0, 8).map((i) => (
                  <li key={i.path.join('.')}>
                    {i.path.join('.')}: {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="block text-sm" htmlFor="cfg-notes">
            {t('notes')}
            <Input
              id="cfg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              className="mt-1"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={publish}
              disabled={
                busy ||
                !draft ||
                diff.length === 0 ||
                notes.trim().length < 3 ||
                !validation?.success
              }
            >
              {t('publish')}
            </Button>
            {draft && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('reset')}
              </Button>
            )}
          </div>
        </section>
        <section className="bg-card rounded-lg border p-4">
          <h3 className="mb-2 font-semibold">{t('versions')}</h3>
          <ol className="space-y-1 text-sm">
            {versions.data?.map((v) => (
              <li key={v.id} className={cn('flex gap-2', v.is_current && 'font-semibold')}>
                <span className="w-10 shrink-0">v{v.version}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate">{v.notes}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {new Date(v.published_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
