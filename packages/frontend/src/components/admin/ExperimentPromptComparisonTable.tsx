import { useEffect, useState } from "react";
import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import { getPerPromptComparison, type PromptComparison, type PromptRunResult } from "../../api/experiment.api";

interface Props {
  token: string;
  experimentId: string;
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
        <Badge variant="destructive" className="text-[0.7rem]">Failed</Badge>
      ) : (
        <div>
          <span style={{ color: scoreColor(run.evalScore) }} className="text-[0.9rem] font-semibold">
            {run.evalScore?.toFixed(1) ?? "-"}
          </span>
          {run.approvalStatus === "auto_approved" && (
            <span className="ml-1 text-[0.7rem] text-[hsl(var(--success))]">A</span>
          )}
          <div className="text-[0.7rem] text-[hsl(var(--muted-foreground))]">
            {run.totalSteps != null && <span>{run.totalSteps}st</span>}
            {run.costUsd != null && <span> ${run.costUsd.toFixed(3)}</span>}
          </div>
        </div>
      )}
    </td>
  );
}

export function ExperimentPromptComparisonTable({ token, experimentId }: Props) {
  const [data, setData] = useState<PromptComparison[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPerPromptComparison(token, experimentId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, experimentId]);

  if (loading) return <SectionCard title="Per-Prompt Comparison"><p className="text-[hsl(var(--muted-foreground))]">Loading...</p></SectionCard>;
  if (data.length === 0) return null;

  // Get unique run labels
  const runLabels = data[0]?.runs.map((r) => r.modelLabel) ?? [];

  return (
    <SectionCard title="Per-Prompt Comparison">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr className="border-b-2 border-[hsl(var(--border))]">
              <th className="p-2 text-left text-[hsl(var(--muted-foreground))]" style={{ width: 40 }}>#</th>
              <th className="p-2 text-left text-[hsl(var(--muted-foreground))]" style={{ minWidth: 200 }}>Prompt</th>
              {runLabels.map((label, i) => (
                <th key={label} className="p-2 text-center" style={{ color: COLORS[i % COLORS.length], minWidth: 100 }}>
                  {label.split("/").pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              // Find winner (highest eval score)
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
                  {row.runs.map((run) => (
                    <ScoreCell
                      key={run.runId}
                      run={run}
                      isWinner={winnerIds.includes(run.runId) && winnerIds.length < row.runs.length}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary row */}
      <div className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
        <strong>Win counts:</strong>{" "}
        {runLabels.map((label, i) => {
          const runIdx = i;
          const wins = data.filter((row) => {
            const scores = row.runs.map((r) => r.evalScore).filter((s): s is number => s != null);
            if (scores.length === 0) return false;
            const maxScore = Math.max(...scores);
            const thisScore = row.runs[runIdx]?.evalScore;
            return thisScore === maxScore && scores.filter((s) => s === maxScore).length === 1;
          }).length;
          return (
            <span key={label} style={{ marginRight: 12, color: COLORS[i % COLORS.length] }}>
              {label.split("/").pop()}: {wins}
            </span>
          );
        })}
      </div>
    </SectionCard>
  );
}

