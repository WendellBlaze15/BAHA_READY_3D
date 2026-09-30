import { StormSignalMeter } from '@/components/storm-signal-meter/storm-signal-meter';

/** Never a blank screen while the level bundle loads (Section 16.3). */
export default function Loading() {
  return (
    <div
      className="bg-storm-slate text-mist auth-rain fixed inset-0 flex items-center justify-center p-6"
      aria-busy="true"
    >
      <div className="relative z-10 w-full max-w-md space-y-4">
        <div className="skeleton h-8 w-64 opacity-30" />
        <StormSignalMeter value={1} label="Loading" className="[&_span]:text-mist/70" />
      </div>
    </div>
  );
}
