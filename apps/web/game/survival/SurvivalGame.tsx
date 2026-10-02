'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { useTranslations } from 'next-intl';
import type { AvatarConfig } from '@/lib/avatar/presets';
import { useProfile, useSettings } from '@/lib/data/me';
import { useSurvivalConfig } from '@/lib/data/survival';
import { attachKeyboard, inputActions } from '@/game/systems/input';
import { detectQuality, isMobileDevice } from '@/game/systems/quality';
import { readCamPrefs } from '@/game/systems/camera';
import { SurvivalHud } from '@/components/survival/hud';
import { SurvivalPanels } from '@/components/survival/panels';
import { ResultsView, type ResultsData } from '@/components/survival/results';
import { ChopTargets, DynamicEntities, LootMarkers, RemotePlayers } from './Entities';
import { LocalPlayer } from './LocalPlayer';
import { useRoomState, useSession } from './session-store';
import { Barangay, Sky, Weather } from './World';

/** Survival 3D session: R3F world + HUD + panels; results overlay at the ending. */
export function SurvivalGame() {
  const t = useTranslations('survival');
  const profile = useProfile();
  const settings = useSettings();
  const version = useRoomState((s) => s.configVersion as number, 1);
  const difficulty = useRoomState((s) => s.difficulty as string, 1);
  const config = useSurvivalConfig(version);
  const results = useSession((s) => s.results);
  const rewards = useSession((s) => s.rewards);
  const quality = useMemo(
    () => detectQuality(settings.data?.graphics_quality),
    [settings.data?.graphics_quality],
  );
  const prefs = useMemo(
    () => readCamPrefs(settings.data?.controls, !!settings.data?.reduced_motion),
    [settings.data],
  );
  const avatar = (profile.data?.avatar_config ?? null) as Partial<AvatarConfig> | null;
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => attachKeyboard(), []);
  // Landscape on phones (Capacitor locks it; browsers get a gentle prompt in the HUD).
  useEffect(() => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (isMobileDevice()) o.lock?.('landscape').catch(() => {});
    return () => o.unlock?.();
  }, []);

  return (
    <div
      className="bg-storm-slate fixed inset-0 z-50 touch-none overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <Canvas
        shadows={quality === 'high'}
        dpr={quality === 'low' ? 1 : [1, 1.75]}
        camera={{ fov: 60, near: 0.2, far: 400, position: [0, 12, 14] }}
        onPointerDown={(e) => {
          // Drag anywhere on the 3D view to orbit the camera (not on HUD controls).
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          inputActions.addLook(e.clientX - d.x, e.clientY - d.y);
          d.x = e.clientX;
          d.y = e.clientY;
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => inputActions.addZoom(e.deltaY)}
        aria-label={t('title')}
      >
        <Suspense fallback={null}>
          <Sky quality={quality} />
          <Barangay />
          <Weather quality={quality} />
          <LootMarkers />
          <ChopTargets />
          <DynamicEntities />
          <RemotePlayers />
          <LocalPlayer config={config} avatar={avatar} prefs={prefs} />
        </Suspense>
      </Canvas>
      <SurvivalHud />
      <SurvivalPanels />
      <p
        className="pointer-events-none fixed inset-x-0 top-1/2 hidden text-center text-white portrait:block portrait:sm:hidden"
        aria-hidden
      >
        <span className="rounded bg-black/60 px-3 py-1 text-sm">{t('rotate')}</span>
      </p>
      {results && (
        <ResultsView
          overlay
          data={{ ...(results as unknown as ResultsData), difficulty: difficulty ?? undefined }}
          rewards={rewards}
        />
      )}
    </div>
  );
}
