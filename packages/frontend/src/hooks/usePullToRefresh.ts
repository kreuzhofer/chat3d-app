import { useEffect, useRef, useState } from "react";

const DEAD_ZONE = 30; // raw px of initial pull ignored (absorbs scroll momentum)
const THRESHOLD = 140; // raw px (after dead zone) to trigger refresh
const VISUAL_MAX = 80; // visual px the indicator travels at most
const RESISTANCE = 0.4; // rubber-band factor — maps raw pull to visual pull
const RELEASE_MS = 300; // spring-back animation duration

interface UsePullToRefreshOptions {
  /** "element" attaches to the returned ref; "window" uses document scroll. */
  mode?: "element" | "window";
}

export interface PullState {
  /** 0–1 normalized visual pull distance. */
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
  const reachedRef = useRef(false);

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
      const target = te.target as HTMLElement;
      if (target.tagName === "CANVAS" || target.closest("canvas")) return;
      if (getScrollTop() > 0) return;
      startY.current = te.touches[0].clientY;
      pulling.current = true;
      reachedRef.current = false;
    }

    function handleTouchMove(e: Event) {
      if (!pulling.current) return;
      const te = e as TouchEvent;
      const rawDelta = te.touches[0].clientY - startY.current;
      if (rawDelta < 0) {
        pulling.current = false;
        reachedRef.current = false;
        setState({ progress: 0, thresholdReached: false, releasing: false, refreshing: false });
        return;
      }
      // Dead zone absorbs scroll-to-top momentum
      const effective = Math.max(0, rawDelta - DEAD_ZONE);
      if (effective === 0) return;
      // Rubber-band: visual distance grows slower than finger distance
      const visual = effective * RESISTANCE;
      const progress = Math.min(visual / VISUAL_MAX, 1);
      const reached = effective >= THRESHOLD;
      reachedRef.current = reached;
      setState({
        progress,
        thresholdReached: reached,
        releasing: false,
        refreshing: false,
      });
    }

    function handleTouchEnd() {
      if (!pulling.current) return;
      pulling.current = false;
      const reached = reachedRef.current;
      reachedRef.current = false;

      if (reached) {
        setState({ progress: 1, thresholdReached: true, releasing: false, refreshing: true });
        setTimeout(() => window.location.reload(), 400);
      } else {
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
