import { Skeleton, SkeletonCard, SkeletonStat } from '@/components/skeletons';

/** Generic player-area skeleton: header + card grid, matching the dashboard layout. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="h-[72px] w-12 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonCard className="h-[164px] lg:col-span-2" />
        <SkeletonCard className="h-[132px]" />
        <SkeletonStat className="h-[132px]" />
        <SkeletonStat className="h-[132px]" />
        <SkeletonStat className="h-[132px]" />
      </div>
    </div>
  );
}
