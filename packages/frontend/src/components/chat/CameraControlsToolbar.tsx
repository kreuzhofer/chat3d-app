import { Focus, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
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
        "flex items-center gap-1 rounded-md bg-[hsl(var(--surface-1)_/_0.85)] p-1 backdrop-blur-sm",
        className,
      )}
      role="toolbar"
      aria-label="Camera controls"
      data-testid="camera-controls-toolbar"
    >
      <Button
        size="sm"
        variant="ghost"
        aria-label="Reset View"
        onClick={onResetView}
        iconLeft={<RotateCcw className="h-3.5 w-3.5" />}
      >
        Reset View
      </Button>

      <Button
        size="sm"
        variant="ghost"
        aria-label="Zoom to Fit"
        onClick={onZoomToFit}
        iconLeft={<Focus className="h-3.5 w-3.5" />}
      >
        Zoom to Fit
      </Button>

      <Button
        size="sm"
        variant="ghost"
        aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        onClick={onToggleFullscreen}
        iconLeft={
          isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )
        }
      >
        {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
      </Button>
    </div>
  );
}
