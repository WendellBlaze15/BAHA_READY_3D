'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useResolveCode } from '@/lib/data/survival';
import { Button } from '@/components/ui/button';

const ALPHABET = /[ABCDEFGHJKMNPQRSTUVWXYZ23456789]/;
const LEN = 6;

/** 6-box room code input (paste-friendly); an invite link pre-fills and auto-joins. */
export function JoinCode({ initial }: { initial?: string }) {
  const t = useTranslations('survival');
  const tr = useTranslations();
  const router = useRouter();
  const resolve = useResolveCode();
  const clean = (s: string) =>
    s
      .toUpperCase()
      .split('')
      .filter((c) => ALPHABET.test(c))
      .join('')
      .slice(0, LEN);
  const [chars, setChars] = useState<string[]>(() => {
    const c = clean(initial ?? '');
    return Array.from({ length: LEN }, (_, i) => c[i] ?? '');
  });
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = chars.join('');
  const [error, setError] = useState<string | null>(null);

  const submit = (c = code) => {
    if (c.length !== LEN) return;
    setError(null);
    resolve.mutate(c, {
      onSuccess: ({ roomId }) => router.push(`/survival/room/${roomId}`),
      onError: (e) => setError((e as { messageKey?: string }).messageKey ?? 'errors.generic'),
    });
  };

  useEffect(() => {
    if (initial && clean(initial).length === LEN) submit(clean(initial));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAt = (i: number, v: string) => {
    const pasted = clean(v);
    if (pasted.length > 1) {
      const next = Array.from({ length: LEN }, (_, k) => pasted[k] ?? '');
      setChars(next);
      refs.current[Math.min(pasted.length, LEN - 1)]?.focus();
      if (pasted.length === LEN) submit(pasted);
      return;
    }
    const next = [...chars];
    next[i] = pasted;
    setChars(next);
    if (pasted && i < LEN - 1) refs.current[i + 1]?.focus();
    if (next.join('').length === LEN) submit(next.join(''));
  };

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-3xl font-bold">{t('joinPage.title')}</h1>
        <p className="text-muted-foreground">{t('joinPage.lede')}</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="mb-2 font-semibold">{t('joinPage.code')}</legend>
          <div className="flex gap-2">
            {chars.map((c, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={c}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !c && i > 0) refs.current[i - 1]?.focus();
                }}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                aria-label={`${t('joinPage.code')} ${i + 1}`}
                className="bg-card focus:border-primary h-14 w-full min-w-0 rounded-lg border-2 text-center font-mono text-2xl font-bold uppercase outline-none"
              />
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-destructive font-medium">
            {tr(error)}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="h-12 w-full"
          disabled={code.length !== LEN || resolve.isPending}
        >
          {resolve.isPending ? t('joinPage.joining') : t('joinPage.submit')}
        </Button>
      </form>
    </div>
  );
}
