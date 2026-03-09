import { Focus, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { cn } from "../../lib/cn";

export interface CameraControlsToolbarProps {
  /** Callback to reset the camera to the default fit-to-object position. */
  onResetView: () => void;
  /** Callback to adjust the camera to frame the entire model. */
  onZoomToFit: () => void;
  /** Callback to toggle fullscreen mode. */
  onToggleFullscreen: () => void;
  /** Whether the viewer is currently in fullscreen mode. */
  isFullscreen: boolean;
  /** Optional additional CSS class for the toolbar wrapper. */
  className?: string;
}

/**
 * Overlay toolbar with camera control buttons for the ModelViewer.
 * Provides Reset View, Zoom to Fit, and Fullscreen toggle.
 *
 * All buttons include accessible `aria-label` attributes and support
 * keyboard activation (Enter, Space) via native `<button>` elements.
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 15.1
 */
export function CameraControlsToolbar({
  onResetView,
  onZoomToFit,
  onToggleFullscreen,
  isFullscreen,
  className,
}: CameraControlsToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg bg-[hsl(var(--surface-1)_/_0.8)] p-0.5 shadow-sm backdrop-blur-md",
        className,
      )}
      role="toolbar"
      aria-label="Camera controls"
      data-testid="camera-controls-toolbar"
    >
      <button
        type="button"
        aria-label="Reset camera"
        onClick={onResetView}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] active:scale-95"
      >
        <RotateCcw className="h-3 w-3" />
        Reset
      </button>

      <button
        type="button"
        aria-label="Zoom to fit"
        onClick={onZoomToFit}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] active:scale-95"
      >
        <Focus className="h-3 w-3" />
        Fit
      </button>

      <button
        type="button"
        aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        onClick={onToggleFullscreen}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] active:scale-95"
      >
        {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        {isFullscreen ? "Exit" : "Fullscreen"}
      </button>
    </div>
  );
}
