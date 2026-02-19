import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "default" | "outline" | "destructive" | "secondary" | "ghost";
type ButtonSize = "default" | "sm" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:brightness-105 disabled:bg-[hsl(var(--muted))]",
  outline:
    "border border-[hsl(var(--border))] bg-white text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
  destructive:
    "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:brightness-105",
  secondary:
    "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:brightness-95",
  ghost: "bg-transparent text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-10 px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "default", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
});
