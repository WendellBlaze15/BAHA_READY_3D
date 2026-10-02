'use client';

import { useSession } from './session-store';

const isNative = () =>
  !!(
    window as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor?.isNativePlatform?.();

/**
 * In-game device behavior (Section 21.6): phones play in landscape, the screen stays on, and
 * sending the app to the background counts as a disconnect (the reconnection window applies;
 * the character waits safely). Web: best-effort orientation lock only.
 */
export async function enterGameMode(): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  if (isNative()) {
    try {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      await ScreenOrientation.lock({ orientation: 'landscape' });
      cleanups.push(() => void ScreenOrientation.unlock());
    } catch {
      /* plugin missing on an old app build */
    }
    try {
      const { KeepAwake } = await import('@capacitor-community/keep-awake');
      await KeepAwake.keepAwake();
      cleanups.push(() => void KeepAwake.allowSleep());
    } catch {
      /* ignore */
    }
    try {
      const { App } = await import('@capacitor/app');
      const pause = await App.addListener('pause', () => {
        // 4010 = "may try reconnect": the server starts the reconnection window now, and the
        // SDK reconnects automatically when the app comes back.
        useSession.getState().room?.connection.close(4010);
      });
      cleanups.push(() => void pause.remove());
    } catch {
      /* ignore */
    }
  } else {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent))
      o.lock?.('landscape').catch(() => {});
    cleanups.push(() => o.unlock?.());
  }
  return () => cleanups.forEach((f) => f());
}

/** Short vibration for hits, downs and rescues (native haptics or the Vibration API). */
export async function buzz(kind: 'light' | 'heavy' = 'light') {
  try {
    if (isNative()) {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light });
    } else navigator.vibrate?.(kind === 'heavy' ? [60, 40, 60] : 25);
  } catch {
    /* ignore */
  }
}
