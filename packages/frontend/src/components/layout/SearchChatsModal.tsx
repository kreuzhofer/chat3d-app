import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MessageSquare, Search, SquarePen, X } from "lucide-react";
import { useChatContexts } from "../../hooks/useChatContexts";

interface SearchChatsModalProps {
  open: boolean;
  onClose: () => void;
}

export function SearchChatsModal({ open, onClose }: SearchChatsModalProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { groupedContexts } = useChatContexts();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredGroups = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return groupedContexts;
    return groupedContexts
      .map((group) => ({
        ...group,
        items: group.items.filter((ctx) => ctx.name.toLowerCase().includes(q)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupedContexts, query]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  function handleSelect(contextId: string) {
    navigate(`/chat/${encodeURIComponent(contextId)}`);
    onClose();
  }

  function handleNewChat() {
    navigate("/chat");
    onClose();
  }

  // Map bucket keys to i18n
  const bucketI18n: Record<string, string> = {
    Today: t("sidebar.today"),
    Yesterday: t("sidebar.yesterday"),
    "Previous 7 Days": t("sidebar.previous7Days"),
    "Previous 30 Days": t("sidebar.previous30Days"),
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh]" role="presentation">
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
        type="button"
      />

      {/* Modal */}
      <div className="relative z-[71] w-full max-w-lg animate-scale-in rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] shadow-[var(--elevation-3)]">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[hsl(var(--border)_/_0.5)] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          <input
            ref={inputRef}
            type="text"
            className="min-w-0 flex-1 bg-transparent text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none"
            placeholder={t("sidebar.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="rounded p-1 text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))]"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* New Chat entry */}
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          onClick={handleNewChat}
        >
          <SquarePen className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
          {t("sidebar.newChat")}
        </button>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {filteredGroups.map((group) => (
            <div key={group.bucket}>
              <div className="px-4 pb-1 pt-3 text-xs text-[hsl(var(--muted-foreground))]">
                {bucketI18n[group.bucket] ?? group.bucket}
              </div>
              {group.items.map((ctx) => (
                <button
                  key={ctx.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                  onClick={() => handleSelect(ctx.id)}
                >
                  <MessageSquare className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
                  <span className="truncate">{ctx.name}</span>
                </button>
              ))}
            </div>
          ))}

          {filteredGroups.length === 0 && query.trim() ? (
            <div className="px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
              {t("sidebar.noResults")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
