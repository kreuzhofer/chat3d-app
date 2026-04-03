/**
 * VLM Per-Example Comparison Table — Shows each example with VLM scores
 * from all runs alongside ground truth metrics.
 */

import { useState } from "react";
import type { VlmExampleComparison } from "../../api/vlm-experiment.api";
import { SectionCard } from "../layout/SectionCard";

interface Props {
  examples: VlmExampleComparison[];
}

function scoreColor(v: number | null): string {
  if (v == null) return "text-[hsl(var(--muted-foreground))]";
  if (v >= 8) return "text-green-600 dark:text-green-400";
  if (v >= 6) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function approvalBadge(status: string): string {
  switch (status) {
    case "human_approved": return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    case "auto_approved": return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
    case "rejected": return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    default: return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
  }
}

type SortKey = "prompt" | "approval" | "assertionPassRate" | "codeEval" | string;

export function VlmPerExampleTable({ examples }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("prompt");
  const [sortAsc, setSortAsc] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (examples.length === 0) return null;

  const runLabels = examples[0]?.runs.map((r) => r.modelLabel) ?? [];

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sorted = [...examples].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "prompt") cmp = a.promptText.localeCompare(b.promptText);
    else if (sortKey === "approval") cmp = a.approvalStatus.localeCompare(b.approvalStatus);
    else if (sortKey === "assertionPassRate") cmp = (a.assertionPassRate ?? -1) - (b.assertionPassRate ?? -1);
    else if (sortKey === "codeEval") cmp = (a.existingCodeEvalScore ?? -1) - (b.existingCodeEvalScore ?? -1);
    else {
      // Sort by VLM score for a specific run
      const idxA = a.runs.findIndex((r) => r.modelLabel === sortKey);
      const idxB = b.runs.findIndex((r) => r.modelLabel === sortKey);
      if (idxA >= 0 && idxB >= 0) cmp = (a.runs[idxA].visualScore ?? -1) - (b.runs[idxB].visualScore ?? -1);
    }
    return sortAsc ? cmp : -cmp;
  });

  const SortHeader = ({ label, sortId, className }: { label: string; sortId: SortKey; className?: string }) => (
    <th
      className={`cursor-pointer p-2 select-none hover:text-[hsl(var(--foreground))] ${className ?? ""}`}
      onClick={() => handleSort(sortId)}
    >
      {label} {sortKey === sortId ? (sortAsc ? "▲" : "▼") : ""}
    </th>
  );

  return (
    <SectionCard title={`Per-Example Comparison (${examples.length} examples)`}>
      <div className="overflow-x-auto p-2">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-[hsl(var(--muted-foreground))]">
              <SortHeader label="Prompt" sortId="prompt" className="min-w-[200px]" />
              <SortHeader label="Status" sortId="approval" />
              <SortHeader label="Assert %" sortId="assertionPassRate" className="text-right" />
              <SortHeader label="Code Eval" sortId="codeEval" className="text-right" />
              <th className="p-2 text-right">Existing VLM</th>
              {runLabels.map((label) => (
                <SortHeader
                  key={label}
                  label={label.split("/").pop() ?? label}
                  sortId={label}
                  className="text-right"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((ex) => (
              <tr
                key={ex.exampleId}
                className="border-b border-[hsl(var(--border)_/_0.3)] hover:bg-[hsl(var(--accent)_/_0.3)]"
              >
                <td className="max-w-[300px] truncate p-2 text-[hsl(var(--foreground))]">
                  <button
                    className="cursor-pointer border-none bg-transparent p-0 text-left hover:underline"
                    onClick={() => setExpandedId(expandedId === ex.exampleId ? null : ex.exampleId)}
                    title={ex.promptText}
                  >
                    {ex.promptText.length > 60 ? ex.promptText.slice(0, 60) + "…" : ex.promptText}
                  </button>
                  {expandedId === ex.exampleId && (
                    <div className="mt-1 whitespace-normal text-[hsl(var(--muted-foreground))]">
                      {ex.promptText}
                      {ex.runs.some((r) => r.issues.length > 0) && (
                        <div className="mt-1">
                          {ex.runs.filter((r) => r.issues.length > 0).map((r) => (
                            <div key={r.runId} className="mt-0.5">
                              <span className="font-semibold">{r.modelLabel.split("/").pop()}:</span>{" "}
                              {r.issues.join("; ")}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-medium ${approvalBadge(ex.approvalStatus)}`}>
                    {ex.approvalStatus.replace("_", " ")}
                  </span>
                </td>
                <td className={`p-2 text-right font-mono ${ex.assertionPassRate != null && ex.assertionPassRate < 1 ? "text-red-600 dark:text-red-400" : "text-[hsl(var(--foreground))]"}`}>
                  {ex.assertionPassRate != null ? `${Math.round(ex.assertionPassRate * 100)}%` : "—"}
                </td>
                <td className={`p-2 text-right font-mono ${scoreColor(ex.existingCodeEvalScore)}`}>
                  {ex.existingCodeEvalScore ?? "—"}
                </td>
                <td className={`p-2 text-right font-mono ${scoreColor(ex.existingVisualScore)}`}>
                  {ex.existingVisualScore ?? "—"}
                </td>
                {ex.runs.map((run) => (
                  <td
                    key={run.runId}
                    className={`p-2 text-right font-mono font-medium ${run.error ? "text-red-600 dark:text-red-400" : scoreColor(run.visualScore)}`}
                    title={run.error ?? undefined}
                  >
                    {run.error ? "ERR" : run.visualScore ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
