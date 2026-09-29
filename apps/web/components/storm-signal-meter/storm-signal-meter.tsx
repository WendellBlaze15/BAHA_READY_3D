import { cn } from '@/lib/utils';

const SEGMENT_COLORS = [
  'bg-signal-1',
  'bg-signal-2',
  'bg-signal-3',
  'bg-signal-4',
  'bg-signal-5',
] as const;

export type StormSignalMeterProps = {
  /** Fill amount from 0 to 5 (fractional values partially fill a segment). */
  value: number;
  /** Accessible label describing what the meter measures. */
  label: string;
  /** Visible value text for screen readers, e.g. "Signal No. 3" or "62%". */
  valueText?: string;
  showNumbers?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const HEIGHT = { sm: 'h-2', md: 'h-3.5', lg: 'h-6' } as const;

/**
 * The signature element: a segmented 5-step bar filled with storm signal colors.
 * Used for level progress, the 3D loading bar, and the Level Select header.
 * State is never communicated by color alone: segments carry number labels.
 */
export function StormSignalMeter({
  value,
  label,
  valueText,
  showNumbers = true,
  size = 'md',
  className,
}: StormSignalMeterProps) {
  const clamped = Math.max(0, Math.min(5, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={Number(clamped.toFixed(2))}
      aria-valuetext={valueText}
      className={cn('w-full', className)}
    >
      <div className="flex gap-1">
        {SEGMENT_COLORS.map((color, i) => {
          const fill = Math.max(0, Math.min(1, clamped - i));
          return (
            <div key={color} className="flex-1">
              <div className={cn('bg-muted relative overflow-hidden rounded-sm', HEIGHT[size])}>
                <div
                  className={cn('absolute inset-0 origin-left', color)}
                  style={{
                    transform: `scaleX(${fill})`,
                    transition: 'transform 280ms var(--ease-out-brand)',
                  }}
                />
              </div>
              {showNumbers && (
                <span
                  aria-hidden
                  className={cn(
                    'font-display mt-1 block text-xs font-semibold tabular-nums',
                    fill > 0 ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {i + 1}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
