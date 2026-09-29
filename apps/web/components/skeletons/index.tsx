import { cn } from '@/lib/utils';

/**
 * Skeleton primitives (Section 16.3). Each matches the final layout's box so CLS stays ~0.
 * `.skeleton-delay` keeps them invisible for the first 150ms to avoid flashing on fast loads.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div aria-hidden className={cn('skeleton skeleton-delay', className)} style={style} />;
}

export function SkeletonText({
  lines = 1,
  className,
  widths,
}: {
  lines?: number;
  className?: string;
  widths?: string[];
}) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: widths?.[i] ?? (i === lines - 1 && lines > 1 ? '60%' : '100%') }}
        />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Skeleton className={cn('rounded-lg', className)} style={{ width: size, height: size * 1.5 }} />
  );
}

export function SkeletonCard({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div aria-hidden className={cn('bg-card rounded-lg border p-5', className)}>
      {children ?? (
        <>
          <Skeleton className="mb-3 h-6 w-1/2" />
          <SkeletonText lines={2} />
        </>
      )}
    </div>
  );
}

export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('bg-card rounded-lg border p-4', className)}>
      <Skeleton className="mb-2 h-3.5 w-20" />
      <Skeleton className="h-8 w-16" />
    </div>
  );
}

export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <div aria-hidden className="flex items-center gap-4 border-b px-4 py-3">
      {Array.from({ length: cols }, (_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  );
}

export function SkeletonLeaderboardRow() {
  return (
    <div aria-hidden className="flex h-16 items-center gap-3 border-b px-4">
      <Skeleton className="h-6 w-8" />
      <Skeleton className="h-10 w-7 rounded-md" />
      <Skeleton className="h-4 flex-1" />
      <Skeleton className="h-5 w-14" />
    </div>
  );
}

export function SkeletonLevelMarker() {
  return (
    <div aria-hidden className="bg-card flex h-28 flex-col justify-between rounded-lg border p-4">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

export function SkeletonChart({ height = 240 }: { height?: number }) {
  return (
    <div aria-hidden className="bg-card rounded-lg border p-4">
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

/** Screen-reader announcement for a loading region. */
export function LoadingAnnouncement({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}
