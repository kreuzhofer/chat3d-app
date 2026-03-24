/**
 * Experiment Outliers — Best & Worst prompts per model.
 * Surfaces highlights (highest eval scores) and weak spots (lowest / failed).
 */

import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import type { PromptComparison, PromptRunResult } from "../../api/experiment.api";

interface Props {
  data: PromptComparison[];
  topN?: number;
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

interface OutlierRow {
  promptIndex: number;
  promptText: string;
  evalScore: number | null;
  visualScore: number | null;
  codeEvalScore: number | null;
  renderStatus: string | null;
  costUsd: number | null;
  totalSteps: number | null;
  approvalStatus: string | null;
}

function toOutlierRow(prompt: PromptComparison, run: PromptRunResult): OutlierRow {
  return {
    promptIndex: prompt.promptIndex,
    promptText: prompt.promptText,
    evalScore: run.evalScore,
    visualScore: run.visualScore,
    codeEvalScore: run.codeEvalScore,
    renderStatus: run.renderStatus,
    costUsd: run.costUsd,
    totalSteps: run.totalSteps,
    approvalStatus: run.approvalStatus,
  };
}

function scoreColor(score: number | null): string {
  if (score === null) return "hsl(var(--muted-foreground))";
  if (score >= 8) return "hsl(var(--success))";
  if (score >= 6) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

function OutlierTable({ rows, label, color }: { rows: OutlierRow[]; label: string; color: string }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold" style={{ color }}>{label}</h4>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr className="border-b border-[hsl(var(--border))]">
            <th className="p-1.5 text-left text-[hsl(var(--muted-foreground))]" style={{ width: 30 }}>#</th>
            <th className="p-1.5 text-left text-[hsl(var(--muted-foreground))]">Prompt</th>
            <th className="p-1.5 text-center text-[hsl(var(--muted-foreground))]">Eval</th>
            <th className="p-1.5 text-center text-[hsl(var(--muted-foreground))]">Visual</th>
            <th className="p-1.5 text-center text-[hsl(var(--muted-foreground))]">Code</th>
            <th className="p-1.5 text-right text-[hsl(var(--muted-foreground))]">Cost</th>
            <th className="p-1.5 text-center text-[hsl(var(--muted-foreground))]">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.promptIndex} className="border-b border-[hsl(var(--border)_/_0.3)]">
              <td className="p-1.5 text-[hsl(var(--muted-foreground))]">{row.promptIndex}</td>
              <td className="max-w-[280px] truncate p-1.5" title={row.promptText}>
                {row.promptText.slice(0, 70)}{row.promptText.length > 70 ? "..." : ""}
              </td>
              <td className="p-1.5 text-center font-semibold" style={{ color: scoreColor(row.evalScore) }}>
                {row.evalScore?.toFixed(1) ?? "-"}
              </td>
              <td className="p-1.5 text-center" style={{ color: scoreColor(row.visualScore) }}>
                {row.visualScore?.toFixed(1) ?? "-"}
              </td>
              <td className="p-1.5 text-center" style={{ color: scoreColor(row.codeEvalScore) }}>
                {row.codeEvalScore?.toFixed(1) ?? "-"}
              </td>
              <td className="p-1.5 text-right text-[hsl(var(--muted-foreground))]">
                {row.costUsd != null ? `$${row.costUsd.toFixed(3)}` : "-"}
              </td>
              <td className="p-1.5 text-center">
                {row.renderStatus === "error" ? (
                  <Badge variant="destructive" className="text-[0.65rem]">Failed</Badge>
                ) : row.approvalStatus === "auto_approved" ? (
                  <Badge variant="secondary" className="text-[0.65rem]">Auto-approved</Badge>
                ) : (
                  <span className="text-[hsl(var(--muted-foreground))]">{row.renderStatus ?? "-"}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExperimentOutliers({ data, topN = 3 }: Props) {
  if (data.length === 0) return null;

  const runLabels = data[0]?.runs.map((r) => r.modelLabel) ?? [];

  // Compute best & worst per model
  const modelOutliers = runLabels.map((label, runIdx) => {
    // Collect rows with valid scores for this run
    const scored: OutlierRow[] = [];
    const failed: OutlierRow[] = [];

    for (const prompt of data) {
      const run = prompt.runs[runIdx];
      if (!run?.exampleId) continue;
      if (run.renderStatus === "error") {
        failed.push(toOutlierRow(prompt, run));
      } else if (run.evalScore != null) {
        scored.push(toOutlierRow(prompt, run));
      }
    }

    // Sort scored by eval score
    const sorted = [...scored].sort((a, b) => (b.evalScore ?? 0) - (a.evalScore ?? 0));
    const best = sorted.slice(0, topN);
    const worst = [...sorted].reverse().slice(0, topN);

    return { label, best, worst, failed };
  });

  return (
    <SectionCard title="Outliers — Best & Worst per Model">
      <div className="space-y-6">
        {modelOutliers.map((model, i) => (
          <div key={model.label} className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: COLORS[i % COLORS.length] }}>
              {model.label.split("/").pop()}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <OutlierTable rows={model.best} label="Best (highest eval)" color="hsl(var(--success))" />
              <OutlierTable rows={model.worst} label="Worst (lowest eval)" color="hsl(var(--destructive))" />
            </div>
            {model.failed.length > 0 && (
              <OutlierTable rows={model.failed} label={`Failed renders (${model.failed.length})`} color="hsl(var(--destructive))" />
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
