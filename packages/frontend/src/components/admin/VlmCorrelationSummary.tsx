/**
 * VLM Correlation Summary — Per-run metrics cards showing score distribution,
 * ground truth correlation, and cost.
 */

import type { VlmRunMetrics } from "../../api/vlm-experiment.api";
import { SectionCard } from "../layout/SectionCard";

interface Props {
  runs: VlmRunMetrics[];
}

function correlationColor(value: number | null): string {
  if (value == null) return "text-[hsl(var(--muted-foreground))]";
  if (value >= 0.7) return "text-green-600 dark:text-green-400";
  if (value >= 0.4) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function separationColor(value: number | null): string {
  if (value == null) return "text-[hsl(var(--muted-foreground))]";
  if (value >= 3) return "text-green-600 dark:text-green-400";
  if (value >= 1.5) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function fmt(v: number | null, fallback = "—"): string {
  return v != null ? String(v) : fallback;
}

function MetricRow({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className={`text-sm font-medium ${colorClass ?? "text-[hsl(var(--foreground))]"}`}>{value}</span>
    </div>
  );
}

export function VlmCorrelationSummary({ runs }: Props) {
  if (runs.length === 0) return null;

  return (
    <SectionCard title="VLM Metrics Summary">
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {runs.map((run) => (
          <div
            key={run.runId}
            className="rounded-lg border border-[hsl(var(--border))] p-4"
          >
            <h4 className="mb-3 text-sm font-semibold text-[hsl(var(--foreground))]">
              {run.modelLabel.split("/").pop()}
            </h4>

            <div className="space-y-0.5">
              <MetricRow label="Evaluated" value={`${run.evaluatedCount}/${run.totalExamples}`} />
              {run.errorCount > 0 && (
                <MetricRow label="Errors" value={String(run.errorCount)} colorClass="text-red-600 dark:text-red-400" />
              )}

              <div className="my-2 border-t border-[hsl(var(--border)_/_0.4)]" />
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Score Distribution</p>
              <MetricRow label="Mean ± StdDev" value={`${fmt(run.avgScore)} ± ${fmt(run.stddevScore)}`} />
              <MetricRow label="Median" value={fmt(run.medianScore)} />
              <MetricRow label="Range" value={`${fmt(run.minScore)}–${fmt(run.maxScore)}`} />

              <div className="my-2 border-t border-[hsl(var(--border)_/_0.4)]" />
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Correlation with Existing Scores</p>
              <MetricRow
                label="vs Existing Visual Score"
                value={fmt(run.correlationExistingVisualScore)}
                colorClass={correlationColor(run.correlationExistingVisualScore)}
              />
              <MetricRow
                label="vs Code Eval Score"
                value={fmt(run.correlationCodeEvalScore)}
                colorClass={correlationColor(run.correlationCodeEvalScore)}
              />
              <MetricRow
                label="vs Assertion Pass Rate"
                value={fmt(run.correlationAssertionPassRate)}
                colorClass={correlationColor(run.correlationAssertionPassRate)}
              />

              <div className="my-2 border-t border-[hsl(var(--border)_/_0.4)]" />
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Discrimination</p>
              <MetricRow label="Avg (assertions pass)" value={fmt(run.avgScoreAssertionPass)} />
              <MetricRow label="Avg (assertions fail)" value={fmt(run.avgScoreAssertionFail)} />
              <MetricRow
                label="Separation"
                value={fmt(run.scoreSeparation)}
                colorClass={separationColor(run.scoreSeparation)}
              />

              <div className="my-2 border-t border-[hsl(var(--border)_/_0.4)]" />
              <p className="text-[0.65rem] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Cost</p>
              <MetricRow label="Prompt tokens" value={run.totalPromptTokens.toLocaleString()} />
              <MetricRow label="Completion tokens" value={run.totalCompletionTokens.toLocaleString()} />
              <MetricRow label="Avg duration" value={run.avgDurationMs != null ? `${(run.avgDurationMs / 1000).toFixed(1)}s` : "—"} />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
