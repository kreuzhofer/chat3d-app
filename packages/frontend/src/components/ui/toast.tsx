import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";
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
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
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
        {toasts.map((toast) => (
          <article
            key={toast.id}
            className={cn(
              "pointer-events-auto rounded-lg border px-3 py-2 shadow-[var(--elevation-2)]",
              toneClasses[toast.tone],
            )}
          >
            <h3 className="text-sm font-semibold">{toast.title}</h3>
            {toast.description ? <p className="mt-1 text-xs">{toast.description}</p> : null}
            {toast.actionLabel && toast.onAction ? (
              <button
                type="button"
                className="mt-2 inline-flex rounded border border-current px-2 py-1 text-xs font-semibold"
                onClick={() => {
                  void toast.onAction?.();
                  setToasts((current) => current.filter((item) => item.id !== toast.id));
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </article>
        ))}
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
