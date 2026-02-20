import type { HTMLAttributes, ReactNode } from "react";
import { Label } from "./label";
import { cn } from "../../lib/cn";

interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  htmlFor: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  children: ReactNode;
}

export function FormField({
  label,
  htmlFor,
  helperText,
  errorText,
  required = false,
  className,
  children,
  ...props
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-1 text-[hsl(var(--destructive))]">*</span> : null}
      </Label>
      {children}
      {helperText ? <p className="text-xs text-[hsl(var(--muted-foreground))]">{helperText}</p> : null}
      {errorText ? <p className="text-xs font-medium text-[hsl(var(--destructive))]">{errorText}</p> : null}
    </div>
  );
}

export function DestructiveActionNotice({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.08)] px-3 py-2 text-sm text-[hsl(var(--destructive))]",
        className,
      )}
      {...props}
    />
  );
}
