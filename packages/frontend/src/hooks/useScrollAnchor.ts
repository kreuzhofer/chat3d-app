import { useCallback, useEffect, useRef, useState } from "react";

const NEAR_BOTTOM_THRESHOLD = 100;

/**
 * Tracks whether the user is scrolled near the bottom of a container
 * and provides a function to programmatically scroll to the bottom.
 */
export function useScrollAnchor(containerRef: React.RefObject<HTMLElement | null>) {
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const suppressScrollEventsRef = useRef(false);

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

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const el = containerRef.current;
      if (!el) return;

      isNearBottomRef.current = true;
      setIsNearBottom(true);

      if (behavior === "instant") {
        el.scrollTop = el.scrollHeight;
        // Follow-up after layout completes to catch late height changes
        // (e.g. message bubbles that haven't fully rendered yet)
        requestAnimationFrame(() => {
          const target = containerRef.current;
          if (target) target.scrollTop = target.scrollHeight;
        });
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
