import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn("text-sm font-medium text-[hsl(var(--foreground))]", className)}
      {...props}
    />
  );
});
