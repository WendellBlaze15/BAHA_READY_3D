import type { DifficultyConfig, SurvivalConfig } from './config.ts';

export const MINUTES_PER_DAY = 1440;
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** Run clock: day 1..totalDays, minute of day 0..1439. */
export type Clock = { day: number; minute: number };

/** In-game minutes per real second for a difficulty. */
export function gameMinutesPerSecond(diff: DifficultyConfig) {
  return MINUTES_PER_DAY / (diff.minutesPerDay * 60);
}

/**
 * Section 6.3: dawn 05–06 (auto-save, respawns), day 06–18, dusk 18–19, night 19–05.
 */
export function phaseAt(minute: number, session: SurvivalConfig['session']): DayPhase {
  const h = minute / 60;
  if (h >= session.dawnHour && h < session.dawnHour + 1) return 'dawn';
  if (h >= session.dawnHour + 1 && h < session.nightStartHour - 1) return 'day';
  if (h >= session.nightStartHour - 1 && h < session.nightStartHour) return 'dusk';
  return 'night';
}

/** Hot hours (10:00–16:00) raise thirst. */
export const isHotHours = (minute: number) => minute >= 600 && minute < 960;

/** 0 (midnight) … 1 (noon) daylight factor for smooth lighting. */
export function daylight(minute: number) {
  return Math.max(0, Math.sin(((minute / MINUTES_PER_DAY) * 2 - 0.5) * Math.PI));
}

/**
 * Advances the clock by real seconds. Sleeping at camp runs time faster. Returns the new clock
 * and whether a dawn (auto-save + respawns) was crossed.
 */
export function advanceClock(
  clock: Clock,
  realSeconds: number,
  diff: DifficultyConfig,
  session: SurvivalConfig['session'],
  sleeping = false,
): { clock: Clock; crossedDawn: boolean; minutesElapsed: number } {
  const rate = gameMinutesPerSecond(diff) * (sleeping ? session.sleepSpeedup : 1);
  const minutesElapsed = realSeconds * rate;
  const dawn = session.dawnHour * 60;
  let { day, minute } = clock;
  let total = minute + minutesElapsed;
  let crossedDawn = minute < dawn && total >= dawn;
  while (total >= MINUTES_PER_DAY) {
    total -= MINUTES_PER_DAY;
    day += 1;
    if (total >= dawn) crossedDawn = true;
  }
  minute = total;
  return { clock: { day, minute }, crossedDawn, minutesElapsed };
}

/** Day 30 helicopter window (difficulty-dependent hours). */
export function helicopterWindowOpen(clock: Clock, diff: DifficultyConfig, totalDays: number) {
  const h = clock.minute / 60;
  return clock.day === totalDays && h >= diff.heliWindow.start && h < diff.heliWindow.end;
}

export function helicopterWindowOver(clock: Clock, diff: DifficultyConfig, totalDays: number) {
  return (
    clock.day > totalDays || (clock.day === totalDays && clock.minute / 60 >= diff.heliWindow.end)
  );
}
