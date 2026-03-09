import { useEffect, useRef, useState } from "react";

const THRESHOLD = 80; // px to pull before triggering refresh
const MAX_PULL = 120; // px cap for visual indicator
const RELEASE_MS = 300; // spring-back animation duration

export const PULL_THRESHOLD_RATIO = THRESHOLD / MAX_PULL;

interface UsePullToRefreshOptions {
  /** "element" attaches to the returned ref; "window" uses document scroll. */
  mode?: "element" | "window";
}

export interface PullState {
  /** 0–1 normalized pull distance. */
  progress: number;
  /** True when pull exceeds the refresh threshold. */
  thresholdReached: boolean;
  /** True during the spring-back animation after release. */
  releasing: boolean;
  /** True when refresh has been triggered and page is reloading. */
  refreshing: boolean;
}

/**
 * Pull-to-refresh hook for touch devices (especially PWA standalone mode).
 * - mode "element": attach the returned ref to a scrollable container.
 * - mode "window": listens on document (for pages that scroll via the viewport).
 */
export function usePullToRefresh({ mode = "element" }: UsePullToRefreshOptions = {}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<PullState>({
    progress: 0,
    thresholdReached: false,
    releasing: false,
    refreshing: false,
  });
  const startY = useRef(0);
  const pulling = useRef(false);
  const progressRef = useRef(0);

  useEffect(() => {
    const isWindowMode = mode === "window";
    const touchTarget: EventTarget = isWindowMode ? document : (ref.current ?? document);

    if (!isWindowMode && !ref.current) return;

    function getScrollTop(): number {
      if (isWindowMode) return window.scrollY;
      return ref.current?.scrollTop ?? 0;
    }

    function handleTouchStart(e: Event) {
      const te = e as TouchEvent;
      if (getScrollTop() > 0) return;
      startY.current = te.touches[0].clientY;
      pulling.current = true;
    }

    function handleTouchMove(e: Event) {
      if (!pulling.current) return;
      const te = e as TouchEvent;
      const deltaY = te.touches[0].clientY - startY.current;
      if (deltaY < 0) {
        pulling.current = false;
        progressRef.current = 0;
        setState({ progress: 0, thresholdReached: false, releasing: false, refreshing: false });
        return;
      }
      const progress = Math.min(deltaY / MAX_PULL, 1);
      progressRef.current = progress;
      setState({
        progress,
        thresholdReached: progress >= PULL_THRESHOLD_RATIO,
        releasing: false,
        refreshing: false,
      });
    }

    function handleTouchEnd() {
      if (!pulling.current) return;
      pulling.current = false;
      const reached = progressRef.current >= PULL_THRESHOLD_RATIO;
      progressRef.current = 0;

      if (reached) {
        // Show refreshing state briefly before reload
        setState({ progress: 1, thresholdReached: true, releasing: false, refreshing: true });
        setTimeout(() => window.location.reload(), 400);
      } else {
        // Spring back
        setState((prev) => ({ ...prev, releasing: true }));
        setTimeout(() => {
          setState({ progress: 0, thresholdReached: false, releasing: false, refreshing: false });
        }, RELEASE_MS);
      }
    }

    touchTarget.addEventListener("touchstart", handleTouchStart, { passive: true });
    touchTarget.addEventListener("touchmove", handleTouchMove, { passive: true });
    touchTarget.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      touchTarget.removeEventListener("touchstart", handleTouchStart);
      touchTarget.removeEventListener("touchmove", handleTouchMove);
      touchTarget.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mode]);

  return { ref, ...state };
}
