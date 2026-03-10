import { useEffect, useRef, useState } from "react";

/**
 * Returns a ref to attach to a DOM element and a boolean indicating whether
 * that element has entered the viewport (with optional margin).
 *
 * The observer is only activated once `enabled` is true, which allows callers
 * to gate visibility detection until after an initial scroll-to-bottom has
 * settled — preventing all viewers from firing during the scroll animation.
 *
 * Once the element has been observed as visible, the observer disconnects
 * and `isVisible` stays true permanently (the model stays loaded).
 */
export function useLazyVisible<T extends HTMLElement = HTMLDivElement>(
  enabled: boolean,
  rootMargin = "200px",
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!enabled || isVisible) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersectable !== undefined ? entry.isIntersecting : entry.intersectionRatio > 0) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, isVisible, rootMargin]);

  return [ref, isVisible];
}
