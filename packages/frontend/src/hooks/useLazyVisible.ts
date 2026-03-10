import { useCallback, useEffect, useState } from "react";

/**
 * Returns a callback ref to attach to a DOM element and a boolean indicating
 * whether that element has entered the viewport (with optional margin).
 *
 * Uses a callback ref (not useRef) so the IntersectionObserver is properly
 * set up when the element first mounts — even if it appears later due to
 * conditional rendering (e.g. model files arriving after generation completes).
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
): [(node: T | null) => void, boolean] {
  const [element, setElement] = useState<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  // Stable callback ref — React calls this when the element mounts/unmounts,
  // which triggers the effect below to set up the IntersectionObserver.
  const callbackRef = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!enabled || isVisible || !element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, isVisible, rootMargin, element]);

  return [callbackRef, isVisible];
}
