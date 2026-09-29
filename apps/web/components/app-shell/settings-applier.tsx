'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useSettings } from '@/lib/data/me';

/**
 * Applies synced user settings to the document: text size (100–150%), reduced motion,
 * and theme. Because settings arrive via Realtime, a change on one device applies live
 * on all others.
 */
export function SettingsApplier() {
  const { data } = useSettings();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    root.style.setProperty('--text-scale', String(data.text_scale ?? 1));
    root.dataset.reducedMotion = data.reduced_motion ? 'true' : 'false';
  }, [data]);

  useEffect(() => {
    if (data?.theme && data.theme !== theme) setTheme(data.theme);
    // Only react to server-side changes, not local toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.theme]);

  return null;
}
