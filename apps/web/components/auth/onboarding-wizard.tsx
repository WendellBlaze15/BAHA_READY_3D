'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Loader2, X } from 'lucide-react';
import {
  AVATAR_PRESETS,
  PILA_BARANGAYS,
  usernameSchema,
  type OnboardingInput,
} from '@baha/shared/auth';
import { useRouter } from '@/i18n/navigation';
import { apiPost, ApiClientError } from '@/lib/api/client';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { presetAvatarConfig, type AvatarPreset } from '@/lib/avatar/presets';
import { BlockyAvatar } from '@/components/avatar/blocky-avatar';
import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useApiErrorText, useFieldErrorText } from './use-api-error';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
const OTHER = '__other__';

export function OnboardingWizard() {
  const t = useTranslations('onboarding');
  const locale = useLocale() as 'fil' | 'en';
  const router = useRouter();
  const reduce = useReducedMotion();
  const errText = useApiErrorText();
  const fieldText = useFieldErrorText();
  const ids = { user: useId(), userMsg: useId(), school: useId(), consent: useId(), err: useId() };

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Omit<OnboardingInput, 'consent'> & { consent: boolean }>({
    username: '',
    avatarPreset: 'lakeside',
    language: locale,
    barangay: '',
    school: '',
    isMinor: false,
    consent: false,
  });
  const [barangayChoice, setBarangayChoice] = useState<string>('');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [usernameError, setUsernameError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Debounced (400ms) username availability check.
  useEffect(() => {
    const name = form.username.trim();
    if (!name) {
      setAvailability('idle');
      setUsernameError(undefined);
      return;
    }
    const parsed = usernameSchema.safeParse(name);
    if (!parsed.success) {
      setAvailability('invalid');
      setUsernameError(fieldText(parsed.error.issues[0]?.message));
      return;
    }
    setAvailability('checking');
    setUsernameError(undefined);
    const id = window.setTimeout(async () => {
      const { data } = await getSupabaseBrowser().rpc('is_username_available', {
        p_username: name,
      });
      setAvailability(data ? 'available' : 'taken');
      if (!data) setUsernameError(fieldText('errors.username_taken'));
    }, 400);
    return () => window.clearTimeout(id);
  }, [form.username, fieldText]);

  const canNext = step === 1 ? availability === 'available' : step === 2 ? true : form.consent;

  async function finish() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await apiPost<{ next: string }>('/api/onboarding', {
        ...form,
        username: form.username.trim(),
        barangay: barangayChoice === OTHER ? form.barangay : barangayChoice,
      });
      const want = new URLSearchParams(window.location.search).get('next');
      const safe = want && want.startsWith('/') && !want.startsWith('//') ? want : res.next;
      router.replace(safe);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.fields.username) {
        setStep(1);
        setAvailability('taken');
        setUsernameError(fieldText(e.fields.username));
      } else setError(errText(e));
      setBusy(false);
    }
  }

  const slide = reduce
    ? {}
    : {
        initial: { opacity: 0, x: 8 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -8 },
        transition: { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] as const },
      };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">{t('stepOf', { step })}</p>
        <StormSignalMeter
          value={(step / 3) * 5}
          label={t('stepOf', { step })}
          showNumbers={false}
          size="sm"
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} {...slide} className="space-y-5">
          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold">{t('step1Title')}</h2>
              <div className="space-y-1.5">
                <Label htmlFor={ids.user}>{t('usernameLabel')}</Label>
                <div className="relative">
                  <Input
                    id={ids.user}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={20}
                    value={form.username}
                    onChange={(e) => set('username', e.target.value)}
                    className="h-12 pr-10 text-base"
                    aria-invalid={
                      availability === 'taken' || availability === 'invalid' || undefined
                    }
                    aria-describedby={ids.userMsg}
                  />
                  <span className="absolute top-3.5 right-3" aria-hidden>
                    {availability === 'checking' && (
                      <Loader2 className="text-muted-foreground size-5 animate-spin" />
                    )}
                    {availability === 'available' && <Check className="text-evac-green size-5" />}
                    {(availability === 'taken' || availability === 'invalid') && (
                      <X className="text-destructive size-5" />
                    )}
                  </span>
                </div>
                <p
                  id={ids.userMsg}
                  aria-live="polite"
                  className={cn(
                    'text-sm',
                    usernameError ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {usernameError ??
                    (availability === 'checking'
                      ? t('usernameChecking')
                      : availability === 'available'
                        ? t('usernameAvailable')
                        : t('usernameHint'))}
                </p>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('avatarLabel')}</legend>
                <RadioGroup
                  value={form.avatarPreset}
                  onValueChange={(v) => set('avatarPreset', v as AvatarPreset)}
                  className="grid grid-cols-3 gap-2 sm:grid-cols-6"
                >
                  {AVATAR_PRESETS.map((p) => (
                    <Label
                      key={p}
                      htmlFor={`preset-${p}`}
                      className={cn(
                        'bg-card flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 p-2 text-center text-xs font-normal',
                        form.avatarPreset === p ? 'border-primary' : 'border-transparent',
                      )}
                    >
                      <RadioGroupItem id={`preset-${p}`} value={p} className="sr-only" />
                      <BlockyAvatar config={presetAvatarConfig(p)} size={44} />
                      {t(`presets.${p}`)}
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-2xl font-bold">{t('step2Title')}</h2>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('languageLabel')}</legend>
                <RadioGroup
                  value={form.language}
                  onValueChange={(v) => set('language', v as 'fil' | 'en')}
                  className="flex gap-3"
                >
                  {(['fil', 'en'] as const).map((l) => (
                    <Label
                      key={l}
                      htmlFor={`lang-${l}`}
                      className="bg-card flex min-h-11 items-center gap-2 rounded-lg border px-4"
                    >
                      <RadioGroupItem id={`lang-${l}`} value={l} />
                      {l === 'fil' ? 'Filipino' : 'English'}
                    </Label>
                  ))}
                </RadioGroup>
              </fieldset>
              <div className="space-y-1.5">
                <Label>{t('barangayLabel')}</Label>
                <Select value={barangayChoice} onValueChange={setBarangayChoice}>
                  <SelectTrigger className="h-12 w-full text-base">
                    <SelectValue placeholder={t('barangayPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {PILA_BARANGAYS.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER}>{t('barangayOther')}</SelectItem>
                  </SelectContent>
                </Select>
                {barangayChoice === OTHER && (
                  <Input
                    aria-label={t('barangayLabel')}
                    maxLength={80}
                    value={form.barangay}
                    onChange={(e) => set('barangay', e.target.value)}
                    className="h-12 text-base"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={ids.school}>{t('schoolLabel')}</Label>
                <Input
                  id={ids.school}
                  maxLength={120}
                  value={form.school}
                  onChange={(e) => set('school', e.target.value)}
                  className="h-12 text-base"
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-bold">{t('step3Title')}</h2>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t('ageLabel')}</legend>
                <RadioGroup
                  value={form.isMinor ? 'minor' : 'adult'}
                  onValueChange={(v) => set('isMinor', v === 'minor')}
                  className="flex flex-wrap gap-3"
                >
                  <Label
                    htmlFor="age-adult"
                    className="bg-card flex min-h-11 items-center gap-2 rounded-lg border px-4"
                  >
                    <RadioGroupItem id="age-adult" value="adult" /> {t('ageAdult')}
                  </Label>
                  <Label
                    htmlFor="age-minor"
                    className="bg-card flex min-h-11 items-center gap-2 rounded-lg border px-4"
                  >
                    <RadioGroupItem id="age-minor" value="minor" /> {t('ageMinor')}
                  </Label>
                </RadioGroup>
              </fieldset>
              {form.isMinor && (
                <p
                  role="note"
                  className="border-signal-amber bg-signal-amber/10 rounded-lg border-l-4 p-3 text-sm"
                >
                  {t('minorNotice')}
                </p>
              )}
              <div className="flex items-start gap-3">
                <Checkbox
                  id={ids.consent}
                  checked={form.consent}
                  onCheckedChange={(v) => set('consent', v === true)}
                  className="mt-1 size-5"
                />
                <Label htmlFor={ids.consent} className="leading-relaxed font-normal">
                  {t('consentLabel')}
                </Label>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {error && (
        <p id={ids.err} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          disabled={step === 1 || busy}
          onClick={() => setStep((s) => s - 1)}
        >
          {t('back')}
        </Button>
        {step < 3 ? (
          <Button
            type="button"
            className="min-h-12"
            disabled={!canNext}
            onClick={() => setStep((s) => s + 1)}
          >
            {t('next')}
          </Button>
        ) : (
          <Button
            type="button"
            className="bg-signal-amber text-storm-slate hover:bg-signal-amber/90 min-h-12 font-bold"
            disabled={!canNext || busy}
            onClick={() => void finish()}
          >
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {t('finish')}
          </Button>
        )}
      </div>
    </div>
  );
}
