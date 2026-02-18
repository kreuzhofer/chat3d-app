import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onCheckedChange?: (checked: boolean) => void;
};

export function Switch({ className, onCheckedChange, onChange, ...props }: SwitchProps) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-[hsl(var(--border))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]",
        className,
      )}
      onChange={(event) => {
        onCheckedChange?.(event.target.checked);
        onChange?.(event);
      }}
      {...props}
    />
  );
}
