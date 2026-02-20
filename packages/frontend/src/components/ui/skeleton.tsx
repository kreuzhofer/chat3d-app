import { cn } from "../../lib/cn";

interface SkeletonProps {
  className?: string;
  /** Number of skeleton lines to render (default 1) */
  lines?: number;
}

/** Animated placeholder shimmer for loading states */
export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-4 rounded-md bg-gradient-to-r from-[hsl(var(--muted))] via-[hsl(var(--surface-1))] to-[hsl(var(--muted))] bg-[length:200%_100%] animate-shimmer",
              i === lines - 1 && "w-3/4",
              className,
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-4 rounded-md bg-gradient-to-r from-[hsl(var(--muted))] via-[hsl(var(--surface-1))] to-[hsl(var(--muted))] bg-[length:200%_100%] animate-shimmer",
        className,
      )}
    />
  );
}

/** Card-shaped skeleton for loading content cards */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-xl border border-[hsl(var(--border))] p-4", className)}>
      <Skeleton className="h-5 w-2/5" />
      <Skeleton lines={3} />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}
