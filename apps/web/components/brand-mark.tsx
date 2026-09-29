import { cn } from '@/lib/utils';

/** Blocky wordmark: a stacked-block house above rising water. Original art. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <rect x="6" y="6" width="20" height="6" rx="1" fill="var(--signal-red)" />
      <rect
        x="8"
        y="12"
        width="16"
        height="10"
        rx="1"
        fill="var(--mist)"
        stroke="var(--storm-slate)"
        strokeWidth="1.5"
      />
      <rect x="14" y="15" width="4" height="7" fill="var(--floodwater)" />
      <rect x="2" y="21" width="28" height="9" rx="2" fill="var(--lake)" />
      <rect x="5" y="24" width="7" height="1.6" rx="0.8" fill="var(--mist)" opacity="0.7" />
      <rect x="17" y="26" width="9" height="1.6" rx="0.8" fill="var(--mist)" opacity="0.7" />
    </svg>
  );
}
