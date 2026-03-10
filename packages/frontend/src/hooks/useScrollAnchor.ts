import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_THRESHOLD = 100;
/** How long after a forced scroll we re-scroll on content mutations (ms). */
const FORCE_SCROLL_WINDOW_MS = 1500;

/**
 * Tracks whether the user is scrolled near the bottom of a container
 * and provides a function to programmatically scroll to the bottom.
 *
 * For forced scrolls (context switch / page reload), uses a MutationObserver
 * to detect late content changes (markdown rendering, fonts, lazy components)
 * and re-scrolls only when content actually mutates — never fighting user input.
 */
export function useScrollAnchor(containerRef: React.RefObject<HTMLElement | null>) {
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const suppressScrollEventsRef = useRef(false);
  /** Active MutationObserver + cleanup for force-scroll window. */
  const forceScrollCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleScroll() {
      if (suppressScrollEventsRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = el!;
      const near = scrollTop + clientHeight >= scrollHeight - NEAR_BOTTOM_THRESHOLD;
      isNearBottomRef.current = near;
      setIsNearBottom(near);
    }

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [containerRef]);

  // Clean up any active force-scroll observer on unmount
  useEffect(() => {
    return () => forceScrollCleanupRef.current?.();
  }, []);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el) return;

      isNearBottomRef.current = true;
      setIsNearBottom(true);

      // Cancel any previous force-scroll observer
      forceScrollCleanupRef.current?.();
      forceScrollCleanupRef.current = null;

      if (behavior === "instant") {
        el.scrollTop = el.scrollHeight;

        // Watch for DOM mutations (content rendering, lazy components mounting)
        // and re-scroll when they happen. Cancels on user touch/wheel or timeout.
        const observer = new MutationObserver(() => {
          // Content changed — re-scroll after layout settles
          requestAnimationFrame(() => {
            const target = containerRef.current;
            if (target) target.scrollTop = target.scrollHeight;
          });
        });

        observer.observe(el, { childList: true, subtree: true, characterData: true });

        const cancel = () => {
          observer.disconnect();
          el.removeEventListener("touchstart", cancel);
          el.removeEventListener("wheel", cancel);
          forceScrollCleanupRef.current = null;
        };

        // Cancel on user interaction so we never fight touch/scroll gestures
        el.addEventListener("touchstart", cancel, { once: true, passive: true });
        el.addEventListener("wheel", cancel, { once: true, passive: true });

        // Auto-cancel after timeout
        const timer = setTimeout(cancel, FORCE_SCROLL_WINDOW_MS);

        forceScrollCleanupRef.current = () => {
          clearTimeout(timer);
          cancel();
        };
      } else {
        // Suppress scroll events during smooth animation to prevent
        // isNearBottom flickering at intermediate scroll positions
        suppressScrollEventsRef.current = true;
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        setTimeout(() => {
          suppressScrollEventsRef.current = false;
        }, 500);
      }
    },
    [containerRef],
  );

  return { isNearBottom, isNearBottomRef, scrollToBottom };
}
