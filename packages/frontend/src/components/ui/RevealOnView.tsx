import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { cn } from "../../lib/cn";

export interface RevealOnViewProps {
  /** Extra classes applied to the wrapper div. */
  className?: string;
  /** Stagger delay in ms added on top of the base animation. */
  delay?: number;
  /** If true, reveal fires immediately (no IntersectionObserver). */
  immediate?: boolean;
}

/**
 * Wraps children in a container that fades + slides up into view
 * when it enters the viewport (or immediately if `immediate` is set).
 *
 * Respects `prefers-reduced-motion` via the CSS animation guard in theme.css.
 */
export function RevealOnView({
  children,
  className,
  delay = 0,
  immediate = false,
}: PropsWithChildren<RevealOnViewProps>) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(immediate);

  useEffect(() => {
    if (immediate || !ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px 0px 80px 0px" },
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [immediate]);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-none",
        visible ? "animate-reveal" : "opacity-0 translate-y-3",
        className,
      )}
      style={delay > 0 && visible ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
