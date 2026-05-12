import { useMemo, useState } from "react";
import type { BatchPromptResult } from "../../api/workbench.api";
import { Button } from "../ui/button";

interface Props {
  results: BatchPromptResult[];
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
}

export function CleanupPreviewTable({ results, onApply, onCancel, applying }: Props) {
  const [filterFellBack, setFilterFellBack] = useState(false);

  const previews = useMemo(
    () => results.filter(r => r.cleanupPreview != null),
    [results],
  );

  const totals = useMemo(() => {
    let prompts = previews.length;
    let totalDrops = 0;
    let fellBack = 0;
    let traceKept = 0;
    for (const r of previews) {
      const p = r.cleanupPreview!;
      totalDrops += p.dropped.length;
      if (p.fellBackToOlder) fellBack++;
      if (p.kept.hasAgentTrace) traceKept++;
    }
    return { prompts, totalDrops, fellBack, traceKept };
  }, [previews]);

  const rowsToShow = filterFellBack
    ? previews.filter(r => r.cleanupPreview!.fellBackToOlder)
    : previews;

  if (previews.length === 0) {
    return (
      <div className="p-4 text-sm text-[hsl(var(--muted-foreground))]">
        Preview still loading — no per-prompt detail available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] p-3 text-sm">
        <div className="font-medium">Preview summary</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Prompts" value={totals.prompts} />
          <Stat label="Will delete" value={totals.totalDrops} />
          <Stat label="Kept with trace" value={totals.traceKept} />
          <Stat
            label="Fell back to older"
            value={totals.fellBack}
            warn={totals.fellBack > 0}
          />
        </div>
        {totals.fellBack > 0 ? (
          <p className="mt-2 text-xs text-[hsl(var(--destructive))]">
            {totals.fellBack} prompt(s) kept an older example because regeneration
            didn't produce an approved result. Consider re-running those prompts.
          </p>
        ) : null}
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={filterFellBack}
          onChange={(e) => setFilterFellBack(e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border border-[hsl(var(--border))]"
        />
        Show only prompts that fell back to an older example
      </label>

      <div className="max-h-96 overflow-auto rounded-lg border border-[hsl(var(--border))]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[hsl(var(--card))]">
            <tr className="border-b border-[hsl(var(--border))]">
              <th className="px-2 py-1.5 font-medium">Prompt</th>
              <th className="px-2 py-1.5 font-medium">Keep</th>
              <th className="px-2 py-1.5 text-right font-medium">Score</th>
              <th className="px-2 py-1.5 font-medium">Date</th>
              <th className="px-2 py-1.5 font-medium">Trace</th>
              <th className="px-2 py-1.5 text-right font-medium">Drop</th>
            </tr>
          </thead>
          <tbody>
            {rowsToShow.map((r) => {
              const p = r.cleanupPreview!;
              return (
                <tr
                  key={r.promptId}
                  className={p.fellBackToOlder ? "bg-[hsl(var(--destructive)/0.08)]" : ""}
                >
                  <td className="px-2 py-1.5 max-w-md truncate" title={r.promptText}>
                    {r.promptText}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px]">
                    {p.kept.id.slice(0, 8)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {p.kept.evalScore != null ? p.kept.evalScore.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {new Date(p.kept.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-1.5">{p.kept.hasAgentTrace ? "✓" : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{p.dropped.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={applying}>
          Cancel
        </Button>
        <Button size="sm" onClick={onApply} disabled={applying}>
          {applying ? "Applying…" : "Apply changes"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-[hsl(var(--muted-foreground))]">
        {label}
      </div>
      <div
        className={`text-base font-semibold ${
          warn ? "text-[hsl(var(--destructive))]" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
