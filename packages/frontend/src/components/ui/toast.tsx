import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { cn } from "../../lib/cn";

export type ToastTone = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface ToastContextValue {
  pushToast: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const toneClasses: Record<ToastTone, string> = {
  info: "border-[hsl(var(--info)_/_0.3)] bg-[hsl(var(--info)_/_0.08)] text-[hsl(var(--foreground))]",
  success: "border-[hsl(var(--success)_/_0.3)] bg-[hsl(var(--success)_/_0.08)] text-[hsl(var(--foreground))]",
  warning: "border-[hsl(var(--warning)_/_0.3)] bg-[hsl(var(--warning)_/_0.08)] text-[hsl(var(--foreground))]",
  danger: "border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.08)] text-[hsl(var(--foreground))]",
};

const toneIcons: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

const toneIconColors: Record<ToastTone, string> = {
  info: "text-[hsl(var(--info))]",
  success: "text-[hsl(var(--success))]",
  warning: "text-[hsl(var(--warning))]",
  danger: "text-[hsl(var(--destructive))]",
};

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const next: ToastItem = { ...toast, id: Date.now() + Math.floor(Math.random() * 1000) };
    setToasts((current) => [next, ...current].slice(0, 5));
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== next.id));
    }, 4500);
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(380px,92vw)] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const Icon = toneIcons[toast.tone];
          return (
            <article
              key={toast.id}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-[var(--elevation-2)]",
                "animate-slide-in-bottom",
                toneClasses[toast.tone],
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneIconColors[toast.tone])} />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{toast.title}</h3>
                {toast.description ? <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{toast.description}</p> : null}
                {toast.actionLabel && toast.onAction ? (
                  <button
                    type="button"
                    className="mt-2 inline-flex rounded border border-current px-2 py-1 text-xs font-semibold transition hover:bg-[hsl(var(--muted))]"
                    onClick={() => {
                      void toast.onAction?.();
                      setToasts((current) => current.filter((item) => item.id !== toast.id));
                    }}
                  >
                    {toast.actionLabel}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
