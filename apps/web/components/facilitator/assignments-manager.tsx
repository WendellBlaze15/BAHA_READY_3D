'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useMyOwnedGroups } from '@/lib/data/facilitator';
import { SkeletonCard } from '@/components/skeletons';
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

type Level = { id: number; name_fil: string; name_en: string };

// Datetime-local values are entered in Asia/Manila time.
const toManilaIso = (local: string) => new Date(`${local}:00+08:00`).toISOString();
const manilaLocal = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16);

function Ring({ done, total }: { done: number; total: number }) {
  const pct = total ? done / total : 0;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${done}/${total}`}>
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--muted)" strokeWidth="6" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        stroke="var(--evac-green)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        transform="rotate(-90 28 28)"
        style={{ transition: 'stroke-dashoffset 400ms' }}
      />
      <text
        x="28"
        y="32"
        textAnchor="middle"
        className="fill-foreground font-display text-[13px] font-bold"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

export function AssignmentsManager({ levels }: { levels: Level[] }) {
  const t = useTranslations('fac');
  const locale = useLocale();
  const format = useFormatter();
  const qc = useQueryClient();
  const groups = useMyOwnedGroups();
  const active = (groups.data ?? []).filter((g) => !g.is_archived);
  const now = new Date();
  const [form, setForm] = useState({
    group: '',
    title: '',
    levels: [1] as number[],
    min: 1,
    starts: manilaLocal(now),
    due: manilaLocal(new Date(now.getTime() + 7 * 86400_000)),
  });
  const [busy, setBusy] = useState(false);
  const gid = form.group || active[0]?.id || '';

  const list = useQuery({
    queryKey: ['groups', 'assignments', 'all', active.map((g) => g.id).join(',')],
    enabled: active.length > 0,
    queryFn: async () => {
      const sb = getSupabaseBrowser();
      const { data, error } = await sb
        .from('assignments')
        .select('*')
        .in(
          'group_id',
          active.map((g) => g.id),
        )
        .order('due_at', { ascending: false });
      if (error) throw error;
      return Promise.all(
        data.map(async (a) => {
          const { data: prog } = await sb.rpc('assignment_progress', { p_assignment_id: a.id });
          return {
            ...a,
            done: (prog ?? []).filter((p) => p.done).length,
            total: (prog ?? []).length,
          };
        }),
      );
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  async function create() {
    setBusy(true);
    const { data: s } = await getSupabaseBrowser().auth.getSession();
    const { error } = await getSupabaseBrowser()
      .from('assignments')
      .insert({
        group_id: gid,
        title: form.title.trim(),
        level_ids: form.levels,
        min_stars: form.min,
        starts_at: toManilaIso(form.starts),
        due_at: toManilaIso(form.due),
        created_by: s.session?.user.id,
      });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t('assigned'));
    setForm({ ...form, title: '' });
    void qc.invalidateQueries({ queryKey: ['groups', 'assignments'] });
  }

  const lvlName = (id: number) => {
    const l = levels.find((x) => x.id === id);
    return l ? (locale === 'en' ? l.name_en : l.name_fil) : `#${id}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-4xl font-bold">{t('assignmentsTitle')}</h1>
      <section className="bg-card space-y-4 rounded-2xl border p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Plus className="size-5" aria-hidden /> {t('newAssignment')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('chooseGroup')}</Label>
            <Select value={gid} onValueChange={(v) => setForm({ ...form, group: v })}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder={t('chooseGroup')} />
              </SelectTrigger>
              <SelectContent>
                {active.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-title">{t('assignmentTitle')}</Label>
            <Input
              id="a-title"
              value={form.title}
              maxLength={120}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-start">{t('startsAt')}</Label>
            <Input
              id="a-start"
              type="datetime-local"
              value={form.starts}
              onChange={(e) => setForm({ ...form, starts: e.target.value })}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-due">{t('dueAt')}</Label>
            <Input
              id="a-due"
              type="datetime-local"
              value={form.due}
              onChange={(e) => setForm({ ...form, due: e.target.value })}
              className="h-11"
            />
          </div>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-bold">{t('chooseLevels')}</legend>
          <div className="flex flex-wrap gap-2">
            {levels.map((l) => {
              const on = form.levels.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setForm({
                      ...form,
                      levels: on
                        ? form.levels.filter((x) => x !== l.id)
                        : [...form.levels, l.id].sort(),
                    })
                  }
                  className={`min-h-11 rounded-lg border-2 px-3 text-sm font-bold ${on ? 'border-primary bg-accent' : 'bg-card'}`}
                >
                  {lvlName(l.id)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-bold">{t('minStars')}</legend>
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={form.min === n}
                onClick={() => setForm({ ...form, min: n })}
                className={`min-h-11 min-w-14 rounded-lg border-2 font-bold ${form.min === n ? 'border-primary bg-accent' : 'bg-card'}`}
              >
                {n}★
              </button>
            ))}
          </div>
        </fieldset>
        <Button
          disabled={
            busy ||
            !gid ||
            form.title.trim().length < 2 ||
            !form.levels.length ||
            form.due <= form.starts
          }
          onClick={() => void create()}
          className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
        >
          {busy && <Loader2 className="animate-spin" aria-hidden />} {t('assign')}
        </Button>
      </section>

      {list.isPending && active.length > 0 ? (
        <SkeletonCard className="h-24" />
      ) : (
        <ul className="space-y-3">
          {(list.data ?? []).map((a) => (
            <li key={a.id} className="bg-card flex items-center gap-4 rounded-lg border p-4">
              <Ring done={a.done} total={a.total} />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{a.title}</p>
                <p className="text-muted-foreground text-sm">
                  {active.find((g) => g.id === a.group_id)?.name} ·{' '}
                  {a.level_ids.map(lvlName).join(', ')} · {a.min_stars}★
                </p>
                <p className="text-muted-foreground text-xs">
                  {format.dateTime(new Date(a.due_at), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Manila',
                  })}{' '}
                  · {t('completionOf', { done: a.done, total: a.total })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
