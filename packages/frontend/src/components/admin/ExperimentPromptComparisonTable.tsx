/**
 * Per-prompt comparison table for experiment results.
 * Shows eval/visual/code scores, cost, duration, and winner highlighting.
 */

import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import type { PromptComparison, PromptRunResult, PromptBaseline } from "../../api/experiment.api";

interface Props {
  data: PromptComparison[];
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

function scoreColor(score: number | null): string {
  if (score === null) return "hsl(var(--muted-foreground))";
  if (score >= 8) return "hsl(var(--success))";
  if (score >= 6) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

function ScoreCell({ run, isWinner }: { run: PromptRunResult; isWinner: boolean }) {
  if (!run.exampleId) return <td className="p-2"><span className="text-[hsl(var(--muted-foreground))]">-</span></td>;

  const failed = run.renderStatus === "error";
  return (
    <td className="p-2" style={{ fontWeight: isWinner ? 700 : 400 }}>
      {failed ? (
        <div>
          <Badge variant="destructive" className="text-[0.7rem]">Failed</Badge>
          {(run.failureReason || run.renderError) && (
            <div className="mt-0.5 max-w-[180px] text-[0.6rem] leading-tight text-[hsl(var(--destructive))]" title={run.failureReason ?? run.renderError ?? ""}>
              {(run.failureReason ?? run.renderError ?? "").slice(0, 80)}{(run.failureReason ?? run.renderError ?? "").length > 80 ? "..." : ""}
            </div>
          )}
        </div>
      ) : (
        <div>
          <span style={{ color: scoreColor(run.evalScore) }} className="text-[0.9rem] font-semibold">
            {run.evalScore?.toFixed(1) ?? "-"}
          </span>
          {run.approvalStatus === "auto_approved" && (
            <span className="ml-1 text-[0.7rem] text-[hsl(var(--success))]">A</span>
          )}
          <div className="flex gap-2 text-[0.65rem] text-[hsl(var(--muted-foreground))]">
            {run.visualScore != null && <span>vis:{run.visualScore.toFixed(1)}</span>}
            {run.codeEvalScore != null && <span>code:{run.codeEvalScore.toFixed(1)}</span>}
          </div>
          <div className="text-[0.65rem] text-[hsl(var(--muted-foreground))]">
            {run.totalSteps != null && <span>{run.totalSteps}st</span>}
            {run.costUsd != null && <span> ${run.costUsd.toFixed(3)}</span>}
            {run.durationMs != null && <span> {(run.durationMs / 1000).toFixed(0)}s</span>}
          </div>
        </div>
      )}
    </td>
  );
}

function BaselineCell({ baseline }: { baseline?: PromptBaseline }) {
  if (!baseline) return <td className="p-2 text-center text-[hsl(var(--muted-foreground))]">—</td>;
  return (
    <td className="p-2 text-center">
      <span style={{ color: scoreColor(baseline.evalScore) }} className="text-[0.9rem] font-semibold">
        {baseline.evalScore.toFixed(1)}
      </span>
      <div className="flex justify-center gap-2 text-[0.65rem] text-[hsl(var(--muted-foreground))]">
        {baseline.visualScore != null && <span>vis:{baseline.visualScore.toFixed(1)}</span>}
        {baseline.codeEvalScore != null && <span>code:{baseline.codeEvalScore.toFixed(1)}</span>}
      </div>
      <div className="text-[0.65rem] text-[hsl(var(--muted-foreground))]">
        {baseline.totalSteps != null && <span>{baseline.totalSteps}st</span>}
        {baseline.costUsd != null && <span> ${baseline.costUsd.toFixed(3)}</span>}
        {baseline.durationMs != null && <span> {(baseline.durationMs / 1000).toFixed(0)}s</span>}
      </div>
      <div className="text-[0.65rem] text-[hsl(var(--muted-foreground))]">
        {baseline.llmModel && <span>{baseline.llmModel.split("/").pop()}</span>}
      </div>
    </td>
  );
}

/** Delta vs baseline: green if experiment scored higher, red if lower. */
function BaselineDeltaCell({ row }: { row: PromptComparison }) {
  if (!row.baseline) return null;
  // Compare best run score against baseline
  const bestRunScore = Math.max(...row.runs.map(r => r.evalScore ?? 0));
  if (bestRunScore === 0) return <td className="p-2 text-center text-[hsl(var(--muted-foreground))]">-</td>;
  const delta = bestRunScore - row.baseline.evalScore;
  if (Math.abs(delta) < 0.05) return <td className="p-2 text-center text-[hsl(var(--muted-foreground))]">=</td>;
  const positive = delta > 0;
  return (
    <td className="p-2 text-center text-xs" style={{ color: positive ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
      {positive ? "+" : ""}{delta.toFixed(1)}
    </td>
  );
}

/** Delta badge: green if this model scored higher, red if lower. */
function DeltaCell({ row }: { row: PromptComparison }) {
  if (row.runs.length !== 2) return null;
  const [a, b] = row.runs;
  if (a.evalScore == null || b.evalScore == null) return <td className="p-2 text-center text-[hsl(var(--muted-foreground))]">-</td>;
  const delta = a.evalScore - b.evalScore;
  if (delta === 0) return <td className="p-2 text-center text-[hsl(var(--muted-foreground))]">=</td>;
  const positive = delta > 0;
  return (
    <td className="p-2 text-center text-xs" style={{ color: positive ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
      {positive ? "+" : ""}{delta.toFixed(1)}
    </td>
  );
}

export function ExperimentPromptComparisonTable({ data }: Props) {
  if (data.length === 0) return null;

  const runLabels = data[0]?.runs.map((r) => r.modelLabel) ?? [];
  const showDelta = runLabels.length === 2;
  const hasBaseline = data.some((row) => row.baseline != null);

  // Compute win counts
  const winCounts = runLabels.map((_, runIdx) =>
    data.filter((row) => {
      const scores = row.runs.map((r) => r.evalScore).filter((s): s is number => s != null);
      if (scores.length === 0) return false;
      const maxScore = Math.max(...scores);
      const thisScore = row.runs[runIdx]?.evalScore;
      return thisScore === maxScore && scores.filter((s) => s === maxScore).length === 1;
    }).length,
  );

  return (
    <SectionCard title="Per-Prompt Comparison">
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr className="border-b-2 border-[hsl(var(--border))]">
              <th className="p-2 text-left text-[hsl(var(--muted-foreground))]" style={{ width: 40 }}>#</th>
              <th className="p-2 text-left text-[hsl(var(--muted-foreground))]" style={{ minWidth: 200 }}>Prompt</th>
              {hasBaseline && (
                <th className="p-2 text-center text-[hsl(var(--muted-foreground))]" style={{ minWidth: 80 }}>Baseline</th>
              )}
              {runLabels.map((label, i) => (
                <th key={label} className="p-2 text-center" style={{ color: COLORS[i % COLORS.length], minWidth: 120 }}>
                  {label.split("/").pop()}
                </th>
              ))}
              {showDelta && (
                <th className="p-2 text-center text-[hsl(var(--muted-foreground))]" style={{ width: 60 }}>Delta</th>
              )}
              {hasBaseline && (
                <th className="p-2 text-center text-[hsl(var(--muted-foreground))]" style={{ width: 60 }}>vs BL</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const scores = row.runs.map((r) => r.evalScore).filter((s): s is number => s != null);
              const maxScore = scores.length > 0 ? Math.max(...scores) : null;
              const winnerIds = maxScore != null
                ? row.runs.filter((r) => r.evalScore === maxScore).map((r) => r.runId)
                : [];

              return (
                <tr key={row.promptId} className="border-b border-[hsl(var(--border)_/_0.4)]">
                  <td className="p-2 text-[hsl(var(--muted-foreground))]">{row.promptIndex}</td>
                  <td className="max-w-[300px] p-2">
                    <span title={row.promptText}>
                      {row.promptText.slice(0, 60)}{row.promptText.length > 60 ? "..." : ""}
                    </span>
                  </td>
                  {hasBaseline && <BaselineCell baseline={row.baseline} />}
                  {row.runs.map((run) => (
                    <ScoreCell
                      key={run.runId}
                      run={run}
                      isWinner={winnerIds.includes(run.runId) && winnerIds.length < row.runs.length}
                    />
                  ))}
                  {showDelta && <DeltaCell row={row} />}
                  {hasBaseline && <BaselineDeltaCell row={row} />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">
        <strong>Wins:</strong>
        {runLabels.map((label, i) => (
          <span key={label} style={{ color: COLORS[i % COLORS.length] }}>
            {label.split("/").pop()}: {winCounts[i]}
          </span>
        ))}
        <span className="text-[hsl(var(--muted-foreground))]">
          Ties: {data.length - winCounts.reduce((a, b) => a + b, 0)}
        </span>
      </div>
    </SectionCard>
  );
}
