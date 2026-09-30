'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { FlaskConical, Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { levelConfigSchema, type LevelConfig } from '@baha/shared/level-config';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { qk } from '@/lib/query-keys';
import { SkeletonCard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { QueryError } from '@/components/query-error';
import { Textarea } from '@/components/ui/textarea';

type LevelRow = {
  id: number;
  slug: string;
  name_fil: string;
  name_en: string;
  current_version_id: string | null;
};
type Version = {
  id: string;
  level_id: number;
  version: number;
  config: unknown;
  notes: string | null;
  published_at: string;
};

export const SANDBOX_KEY = (slug: string) => `baha.sandbox.${slug}`;

export function LevelsAdmin() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const format = useFormatter();
  const qc = useQueryClient();
  const [levelId, setLevelId] = useState<number>(1);
  const [draft, setDraft] = useState<LevelConfig | null>(null);
  const [json, setJson] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: qk.admin.levels(),
    queryFn: async () => {
      const sb = getSupabaseBrowser();
      const [{ data: levels }, { data: versions }] = await Promise.all([
        sb
          .from('levels')
          .select('id, slug, name_fil, name_en, current_version_id')
          .order('sort_order'),
        sb
          .from('level_versions')
          .select('id, level_id, version, config, notes, published_at')
          .order('version', { ascending: false }),
      ]);
      return { levels: (levels ?? []) as LevelRow[], versions: (versions ?? []) as Version[] };
    },
  });
  const level = data?.levels.find((l) => l.id === levelId);
  const versions = data?.versions.filter((v) => v.level_id === levelId) ?? [];
  const current = versions.find((v) => v.id === level?.current_version_id);

  useEffect(() => {
    if (!current) return;
    const parsed = levelConfigSchema.safeParse(current.config);
    if (parsed.success) {
      setDraft(parsed.data);
      setJson(
        JSON.stringify(
          {
            items: parsed.data.items,
            homeTasks: parsed.data.homeTasks,
            hazards: parsed.data.hazards,
            npcs: parsed.data.npcs,
            announcements: parsed.data.announcements,
            requiredItems: parsed.data.requiredItems,
          },
          null,
          2,
        ),
      );
    }
  }, [current]);

  const merged = (): LevelConfig | null => {
    if (!draft) return null;
    try {
      const extra = JSON.parse(json);
      const res = levelConfigSchema.safeParse({ ...draft, ...extra });
      if (!res.success) {
        toast.error(res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        return null;
      }
      return res.data;
    } catch {
      toast.error('JSON');
      return null;
    }
  };

  const publish = async () => {
    const cfg = merged();
    if (!cfg) return;
    setBusy(true);
    const { error } = await getSupabaseBrowser().rpc('publish_level_version', {
      p_level_id: levelId,
      p_config: cfg as never,
      p_notes: notes || undefined,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(t('publishedV', { v: (versions[0]?.version ?? 0) + 1 }));
    setNotes('');
    void qc.invalidateQueries({ queryKey: qk.admin.levels() });
  };

  const sandbox = () => {
    const cfg = merged();
    if (!cfg || !level) return;
    try {
      sessionStorage.setItem(SANDBOX_KEY(level.slug), JSON.stringify(cfg));
    } catch {
      // storage blocked: sandbox falls back to the published config
    }
    window.open(
      `${locale === 'en' ? '/en' : ''}/play/${level.slug}?sandbox=1`,
      '_blank',
      'noopener',
    );
  };

  const num = (k: keyof LevelConfig, label: string, min: number, max: number, step: number) =>
    draft && (
      <div className="space-y-1.5">
        <Label className="flex justify-between">
          <span>{label}</span>
          <span className="tabular-nums">{String(draft[k] ?? '∞')}</span>
        </Label>
        <Slider
          min={min}
          max={max}
          step={step}
          value={[Number(draft[k] ?? max)]}
          onValueChange={([v]) => setDraft({ ...draft, [k]: v } as LevelConfig)}
          aria-label={label}
        />
      </div>
    );

  if (error)
    return <QueryError error={error} retrying={isFetching} onRetry={() => void refetch()} />;
  if (isPending || !data) return <SkeletonCard className="h-96" />;
  return (
    <div className="space-y-5">
      <h1 className="text-4xl font-bold">{t('levelsTitle')}</h1>
      <div role="tablist" className="bg-muted flex flex-wrap gap-1 rounded-lg p-1">
        {data.levels.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={l.id === levelId}
            onClick={() => setLevelId(l.id)}
            className={`min-h-10 rounded-md px-3 text-sm font-bold ${l.id === levelId ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
          >
            {locale === 'en' ? l.name_en : l.name_fil}
          </button>
        ))}
      </div>
      {draft && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <section className="bg-card space-y-5 rounded-lg border p-5">
            <p className="text-muted-foreground text-sm">
              {t('version', { v: current?.version ?? 0 })}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              {draft.prepTimeSec !== null && num('prepTimeSec', 'prepTimeSec (s)', 20, 300, 5)}
              {num('evacTimeSec', 'evacTimeSec (s)', 30, 300, 5)}
              {num('minDurationSec', 'minDurationSec (s)', 5, 120, 1)}
              {num('weightLimitKg', 'weightLimitKg', 3, 20, 0.5)}
              {num('waterRiseSpeed', 'waterRiseSpeed (m/s)', 0, 0.03, 0.001)}
              {num('rainIntensity', 'rainIntensity', 0, 1, 0.05)}
              {num('currentStrength', 'currentStrength', 0, 1, 0.05)}
              {num('maxSpeed', 'maxSpeed (m/s)', 3, 10, 0.5)}
            </div>
            <div className="flex flex-wrap gap-6">
              {(['night', 'lightning'] as const).map((k) => (
                <div key={k} className="flex min-h-11 items-center gap-2">
                  <Switch
                    id={`sw-${k}`}
                    checked={draft[k]}
                    onCheckedChange={(v) => setDraft({ ...draft, [k]: v })}
                  />
                  <Label htmlFor={`sw-${k}`}>{k}</Label>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-json">
                items · homeTasks · hazards · npcs · announcements · requiredItems (JSON)
              </Label>
              <Textarea
                id="cfg-json"
                rows={14}
                className="font-mono text-xs"
                value={json}
                onChange={(e) => setJson(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-notes">{t('notes')}</Label>
              <Input
                id="cfg-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-11"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-12" onClick={sandbox}>
                <FlaskConical aria-hidden /> {t('sandbox')}
              </Button>
              <Button
                className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
                disabled={busy}
                onClick={() => void publish()}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}{' '}
                {t('publish')}
              </Button>
            </div>
          </section>
          <aside className="bg-card rounded-lg border p-5">
            <h2 className="mb-3 font-bold">{t('history')}</h2>
            <ol className="space-y-2 text-sm">
              {versions.map((v) => (
                <li key={v.id} className={v.id === level?.current_version_id ? 'font-bold' : ''}>
                  v{v.version} ·{' '}
                  {format.dateTime(new Date(v.published_at), { dateStyle: 'medium' })}
                  {v.notes && (
                    <span className="text-muted-foreground block text-xs">{v.notes}</span>
                  )}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}
