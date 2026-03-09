import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";

interface PullToRefreshIndicatorProps {
  progress: number;
  thresholdReached: boolean;
  releasing: boolean;
  refreshing: boolean;
}

export function PullToRefreshIndicator({
  progress,
  thresholdReached,
  releasing,
  refreshing,
}: PullToRefreshIndicatorProps) {
  const visible = progress > 0 || releasing || refreshing;
  if (!visible) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center",
        releasing && "transition-transform duration-300 ease-in",
      )}
      style={{
        transform: releasing
          ? "translateY(-48px)"
          : `translateY(${progress * 48 - 48}px)`,
        opacity: releasing ? 0 : Math.min(progress * 1.5, 1),
      }}
    >
      <div
        className={cn(
          "mt-2 flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--surface-1))] shadow-md transition-shadow duration-200",
          thresholdReached && "shadow-lg shadow-[hsl(var(--primary)_/_0.25)]",
        )}
      >
        <RefreshCw
          className={cn(
            "h-4 w-4 transition-colors duration-200",
            thresholdReached
              ? "text-[hsl(var(--primary))]"
              : "text-[hsl(var(--muted-foreground))]",
            refreshing && "animate-spin",
          )}
          style={refreshing ? undefined : { transform: `rotate(${progress * 360}deg)` }}
        />
      </div>
    </div>
  );
}
