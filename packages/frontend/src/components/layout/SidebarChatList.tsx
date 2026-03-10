import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { useChatContexts } from "../../hooks/useChatContexts";
import { ChatEntryMenu } from "./ChatEntryMenu";

const INITIAL_VISIBLE = 20;
const LOAD_MORE_INCREMENT = 20;

interface SidebarChatListProps {
  activeContextId: string | null;
}

export function SidebarChatList({ activeContextId }: SidebarChatListProps) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const { groupedContexts, renameContext, deleteContext } = useChatContexts();

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const { flatItems, totalCount } = useMemo(() => {
    let count = 0;
    const flat: { bucket: string; items: typeof groupedContexts[0]["items"] }[] = [];
    for (const group of groupedContexts) {
      const remaining = visibleCount - count;
      if (remaining <= 0) break;
      const sliced = group.items.slice(0, remaining);
      flat.push({ bucket: group.bucket, items: sliced });
      count += sliced.length;
    }
    const total = groupedContexts.reduce((sum, g) => sum + g.items.length, 0);
    return { flatItems: flat, totalCount: total };
  }, [groupedContexts, visibleCount]);

  const startRename = useCallback(
    (context: { id: string; name: string }) => {
      setEditingId(context.id);
      setEditingValue(context.name);
    },
    [],
  );

  const commitRename = useCallback(
    (context: { id: string; name: string }) => {
      const trimmed = editingValue.trim();
      setEditingId(null);
      if (trimmed && trimmed !== context.name) {
        void renameContext(context as Parameters<typeof renameContext>[0], trimmed);
      }
    },
    [editingValue, renameContext],
  );

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setEditingValue("");
  }, []);

  const handleDelete = useCallback(
    (context: { id: string; name: string }) => {
      if (window.confirm(`Delete "${context.name}"?`)) {
        void deleteContext(context as Parameters<typeof deleteContext>[0]);
      }
    },
    [deleteContext],
  );

  const bucketI18n: Record<string, string> = {
    Today: t("sidebar.today"),
    Yesterday: t("sidebar.yesterday"),
    "Previous 7 Days": t("sidebar.previous7Days"),
    "Previous 30 Days": t("sidebar.previous30Days"),
  };

  return (
    <div className="px-2 pt-1">
      {flatItems.map((group) => (
        <div key={group.bucket}>
          <div className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground)_/_0.7)]">
            {bucketI18n[group.bucket] ?? group.bucket}
          </div>
          {group.items.map((ctx) => (
            <div
              key={ctx.id}
              role="button"
              tabIndex={editingId === ctx.id ? -1 : 0}
              className={cn(
                "group flex min-w-0 cursor-pointer items-center justify-between gap-1 rounded-md px-3 py-1.5 text-sm transition",
                activeContextId === ctx.id
                  ? "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)_/_0.5)] hover:text-[hsl(var(--foreground))]",
              )}
              onClick={() => {
                if (editingId !== ctx.id) {
                  navigate(`/chat/${encodeURIComponent(ctx.id)}`);
                }
              }}
              onKeyDown={(e) => {
                if (editingId !== ctx.id && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  navigate(`/chat/${encodeURIComponent(ctx.id)}`);
                }
              }}
            >
              {editingId === ctx.id ? (
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-base text-[hsl(var(--foreground))] outline-none ring-1 ring-[hsl(var(--primary)_/_0.5)]"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={() => commitRename(ctx)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelRename();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="truncate">{ctx.name}</span>
              )}
              {editingId !== ctx.id ? (
                <ChatEntryMenu
                  onRename={() => startRename(ctx)}
                  onDelete={() => handleDelete(ctx)}
                />
              ) : null}
            </div>
          ))}
        </div>
      ))}

      {visibleCount < totalCount ? (
        <button
          type="button"
          className="w-full px-3 py-2 text-left text-xs text-[hsl(var(--primary))] transition hover:underline"
          onClick={() => setVisibleCount((prev) => prev + LOAD_MORE_INCREMENT)}
        >
          {t("sidebar.showMore")}
        </button>
      ) : null}
    </div>
  );
}
