import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Spinner } from "./spinner";

type ButtonVariant = "default" | "outline" | "destructive" | "secondary" | "ghost";
type ButtonSize = "default" | "sm" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:brightness-105 disabled:bg-[hsl(var(--muted))]",
  outline:
    "border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
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
  icon: "h-9 w-9",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show a loading spinner and disable the button */
  loading?: boolean;
  /** Icon element rendered before children */
  iconLeft?: ReactNode;
  /** Icon element rendered after children */
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "default", type = "button", loading, iconLeft, iconRight, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : iconLeft ? <span className="shrink-0">{iconLeft}</span> : null}
      {children}
      {iconRight && !loading ? <span className="shrink-0">{iconRight}</span> : null}
    </button>
  );
});
