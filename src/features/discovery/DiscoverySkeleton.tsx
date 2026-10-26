import { Skeleton } from "@/components/ui/skeleton";

export default function DiscoverySkeleton() {
  return (
    <div data-testid="discovery-loading" aria-busy="true">
      <div className="border-border/80 grid gap-0 overflow-hidden rounded-lg border md:grid-cols-[minmax(0,1.45fr)_minmax(260px,1fr)]">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="flex flex-col justify-center gap-4 p-6">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="space-y-2.5">
            <Skeleton className="aspect-video w-full rounded-md" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
