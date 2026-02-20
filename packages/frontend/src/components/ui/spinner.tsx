import { cn } from "../../lib/cn";

type SpinnerSize = "sm" | "md" | "lg";

const sizeClasses: Record<SpinnerSize, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-[3px]",
};

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
}

/** Inline spinning loading indicator */
export function Spinner({ size = "md", className, label = "Loading" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block rounded-full border-[hsl(var(--primary))] border-t-transparent animate-spin",
        sizeClasses[size],
        className,
      )}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
