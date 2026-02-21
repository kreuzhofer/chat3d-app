import { MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import type { ChatContext } from "../../api/chat.api";
import { Button } from "../ui/button";
import { EmptyState } from "../layout/EmptyState";

type ContextBucket = "Today" | "Last 7 days" | "Older";

export interface ContextSidebarProps {
  groupedContexts: Record<ContextBucket, ChatContext[]>;
  activeContextId: string | null;
  isDraftRoute: boolean;
  busyAction: string | null;
  token: string | null;
  onNavigateNew: () => void;
  onCreateNamed: (name: string) => void;
  onSelect: (contextId: string) => void;
  onRename: (context: ChatContext) => void;
  onDelete: (context: ChatContext) => void;
}

export function ContextSidebar({
  groupedContexts,
  activeContextId,
  isDraftRoute,
  busyAction,
  token,
  onNavigateNew,
  onCreateNamed,
  onSelect,
  onRename,
  onDelete,
}: ContextSidebarProps) {
  const buckets = Object.keys(groupedContexts) as ContextBucket[];
  const totalContexts = buckets.reduce((sum, b) => sum + groupedContexts[b].length, 0);

  return (
    <div className="space-y-3 rounded-xl border bg-[hsl(var(--surface-1))] p-3 shadow-[var(--elevation-1)]">
      <div className="flex items-center gap-2">
        <Button
          variant={isDraftRoute ? "secondary" : "outline"}
          className="flex-1"
          iconLeft={<MessageSquare className="h-4 w-4" />}
          onClick={onNavigateNew}
        >
          New Chat
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label="Create named context"
          disabled={!token || busyAction !== null}
          onClick={() => {
            const name = window.prompt("Context name (leave blank for default)");
            if (name !== null) {
              onCreateNamed(name);
            }
          }}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {buckets.map((bucket) => {
          const bucketItems = groupedContexts[bucket];
          if (bucketItems.length === 0) {
            return null;
          }

          return (
            <section key={bucket} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">
                {bucket}
              </h3>
              <ul className="space-y-2">
                {bucketItems.map((context) => (
                  <li
                    key={context.id}
                    className={`group cursor-pointer rounded-md border p-2.5 transition hover:border-[hsl(var(--primary)_/_0.4)] ${
                      activeContextId === context.id
                        ? "border-[hsl(var(--primary)_/_0.6)] bg-[hsl(var(--primary)_/_0.06)]"
                        : "border-[hsl(var(--border)_/_0.4)]"
                    }`}
                    onClick={() => onSelect(context.id)}
                    data-testid={`open-context-${context.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium">{context.name}</span>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
                        {new Date(context.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 opacity-0 transition group-hover:opacity-100">
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft={<Pencil className="h-3 w-3" />}
                        disabled={busyAction !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRename(context);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconLeft={<Trash2 className="h-3 w-3" />}
                        className="text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive)_/_0.1)]"
                        disabled={busyAction !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(context);
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {totalContexts === 0 ? (
          <EmptyState title="No contexts yet" description="Start a draft message or create a named context." />
        ) : null}
      </div>
    </div>
  );
}
