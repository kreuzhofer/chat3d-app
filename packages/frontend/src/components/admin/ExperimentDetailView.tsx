import { useCallback, useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  getExperiment,
  getExperimentComparison,
  getExperimentStatus,
  getPerPromptComparison,
  startExperiment,
  cancelExperiment,
  rerunExperiment,
  retryFailedRuns,
  type Experiment,
  type RunMetrics,
  type BaselineMetrics,
  type ExperimentStatus,
  type PromptComparison,
} from "../../api/experiment.api";
import { ExperimentPromptComparisonTable } from "./ExperimentPromptComparisonTable";
import { ExperimentOutliers } from "./ExperimentOutliers";
import { PerPromptBarCharts } from "./PerPromptBarCharts";
import { ExperimentCreateDialog } from "./ExperimentCreateDialog";
import { ExperimentFewShotChart } from "./ExperimentFewShotChart";

interface Props {
  token: string;
  experimentId: string;
  onBack: () => void;
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

export function ExperimentDetailView({ token, experimentId, onBack }: Props) {
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [comparison, setComparison] = useState<RunMetrics[] | null>(null);
  const [baseline, setBaseline] = useState<BaselineMetrics | null>(null);
  const [promptData, setPromptData] = useState<PromptComparison[] | null>(null);
  const [status, setStatus] = useState<ExperimentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const exp = await getExperiment(token, experimentId);
      setExperiment(exp);
      // Load comparison data for any non-created status (including running)
      if (exp.status !== "created") {
        const [comp, prompts] = await Promise.all([
          getExperimentComparison(token, experimentId),
          getPerPromptComparison(token, experimentId),
        ]);
        setComparison(comp.runs);
        setBaseline(comp.baseline);
        setPromptData(prompts);
      }
      if (exp.status === "running") {
        const st = await getExperimentStatus(token, experimentId);
        setStatus(st);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load experiment");
    } finally {
      setLoading(false);
    }
  }, [token, experimentId]);

  useEffect(() => { load(); }, [load]);

  // Poll when running
  useEffect(() => {
    if (experiment?.status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const [st, comp, prompts] = await Promise.all([
          getExperimentStatus(token, experimentId),
          getExperimentComparison(token, experimentId),
          getPerPromptComparison(token, experimentId),
        ]);
        setStatus(st);
        setComparison(comp.runs);
        setBaseline(comp.baseline);
        setPromptData(prompts);
        if (st.status !== "running") load();
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [experiment?.status, token, experimentId, load]);

  if (loading) return <div className="p-4 text-[hsl(var(--muted-foreground))]">Loading...</div>;
  if (!experiment) return <InlineAlert variant="error" message={error ?? "Experiment not found"} />;

  return (
    <div className="p-4">
      <Button variant="outline" size="sm" onClick={onBack} className="mb-4">Back to list</Button>

      <ExperimentHeader experiment={experiment} status={status} token={token} onRefresh={load} setError={setError} onEdit={() => setShowEdit(true)} />

      {showEdit && (
        <ExperimentCreateDialog
          token={token}
          experiment={experiment}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}

      {error && <InlineAlert variant="error" message={error} />}

      {experiment.status === "running" && status && (
        <RunProgressSection status={status} promptCount={experiment.promptCount} />
      )}

      {comparison && comparison.length > 0 && (
        <>
          <ComparisonTable runs={comparison} baseline={baseline} />
          <ComparisonCharts runs={comparison} baseline={baseline} />
          <ExperimentFewShotChart runs={comparison} />
          {promptData && <ExperimentOutliers data={promptData} />}
          {promptData && <ExperimentPromptComparisonTable data={promptData} />}
          {promptData && <PerPromptBarCharts data={promptData} />}
        </>
      )}
    </div>
  );
}

// ── Progress Bar ─────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--muted))]">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color ?? "hsl(var(--primary))" }}
      />
    </div>
  );
}

function RunProgressSection({ status, promptCount }: { status: ExperimentStatus; promptCount: number }) {
  const totalCompleted = status.runs.reduce((sum, r) => sum + r.completedPrompts, 0);
  const totalExpected = status.runs.length * promptCount;
  const overallPct = totalExpected > 0 ? Math.round((totalCompleted / totalExpected) * 100) : 0;

  return (
    <SectionCard title={`Progress — ${overallPct}%`}>
      <div className="mb-3">
        <ProgressBar value={totalCompleted} max={totalExpected} />
      </div>
      <div className="space-y-3">
        {status.runs.map((r, i) => {
          const pct = promptCount > 0 ? Math.round((r.completedPrompts / promptCount) * 100) : 0;
          return (
            <div key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex items-center gap-2 sm:contents">
                <Badge variant={r.status === "running" ? "default" : r.status === "completed" ? "secondary" : "outline"} className="justify-center text-[0.65rem] sm:w-20">
                  {r.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm sm:w-40 sm:flex-none">{r.modelLabel.split("/").pop()}</span>
              </div>
              <div className="flex items-center gap-2 sm:contents">
                <div className="flex-1">
                  <ProgressBar value={r.completedPrompts} max={promptCount} color={COLORS[i % COLORS.length]} />
                </div>
                <span className="whitespace-nowrap text-right text-xs text-[hsl(var(--muted-foreground))] sm:w-24">
                  {r.completedPrompts}/{promptCount} ({pct}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function ExperimentHeader({ experiment, status, token, onRefresh, setError, onEdit }: {
  experiment: Experiment;
  status: ExperimentStatus | null;
  token: string;
  onRefresh: () => void;
  setError: (e: string | null) => void;
  onEdit: () => void;
}) {
  const canRerun = ["completed", "failed", "cancelled"].includes(experiment.status);
  const canEdit = experiment.status !== "running";
  const hasPendingRuns = experiment.runs.some((r) => r.status === "pending");
  const hasFailedRuns = experiment.runs.some((r) => r.status === "failed");

  return (
    <SectionCard title={experiment.name}>
      <div className="mb-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 md:grid-cols-3">
        <div><strong>Categories:</strong> {experiment.categories.map(c => c.name).join(", ")}</div>
        <div><strong>Purpose:</strong> <code>{experiment.testedPurpose}</code></div>
        <div><strong>Status:</strong> <Badge variant={experiment.status === "running" ? "default" : "secondary"}>{experiment.status}</Badge></div>
        <div><strong>Prompts:</strong> {experiment.promptCount} (seed: {experiment.promptSeed})</div>
        <div><strong>Runs:</strong> {experiment.runs.length}</div>
        {experiment.fewShotCounts && experiment.fewShotCounts.length > 0 && (
          <div><strong>Few-Shot Counts:</strong> {experiment.fewShotCounts.join(", ")}</div>
        )}
        <div><strong>Created:</strong> {new Date(experiment.createdAt).toLocaleDateString()}</div>
      </div>

      <div className="mb-2 flex flex-wrap gap-2 text-sm">
        <strong>Models:</strong>
        {experiment.runs.map((r, i) => (
          <Badge key={r.id} style={{ backgroundColor: COLORS[i % COLORS.length] + "22", color: COLORS[i % COLORS.length] }}>
            {r.modelLabel}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
        )}
        {hasPendingRuns && experiment.status !== "running" && (
          <Button size="sm" onClick={async () => { try { await startExperiment(token, experiment.id); onRefresh(); } catch (e) { setError((e as Error).message); } }}>
            {experiment.status === "created" ? "Start Experiment" : "Continue"}
          </Button>
        )}
        {experiment.status === "running" && (
          <Button size="sm" variant="outline" onClick={async () => { try { await cancelExperiment(token, experiment.id); onRefresh(); } catch (e) { setError((e as Error).message); } }}>
            Cancel
          </Button>
        )}
        {hasFailedRuns && experiment.status !== "running" && (
          <Button size="sm" variant="outline" onClick={async () => {
            if (!window.confirm("Retry all failed runs? Their partial results will be deleted.")) return;
            try { await retryFailedRuns(token, experiment.id); onRefresh(); } catch (e) { setError((e as Error).message); }
          }}>
            Retry Failed
          </Button>
        )}
        {canRerun && (
          <Button size="sm" variant="outline" onClick={async () => {
            if (!window.confirm("Re-run this experiment? This will delete all existing results and start fresh.")) return;
            try { await rerunExperiment(token, experiment.id); onRefresh(); } catch (e) { setError((e as Error).message); }
          }}>
            Re-run All
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

// ── Comparison Table ────────────────────────────────────────────────

function ComparisonTable({ runs, baseline }: { runs: RunMetrics[]; baseline: BaselineMetrics | null }) {
  const BASELINE_ID = "__baseline__";
  const BASELINE_COLOR = "#6b7280";

  const metrics: Array<{
    label: string;
    key: keyof RunMetrics;
    format: (v: number | null) => string;
    higherBetter: boolean;
    baselineValue: (b: BaselineMetrics) => number | null;
  }> = [
    { label: "Success Rate", key: "successRate", format: (v) => v != null ? `${(v * 100).toFixed(1)}%` : "-", higherBetter: true, baselineValue: (b) => b.successRate },
    { label: "Avg Eval Score", key: "avgEvalScore", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true, baselineValue: (b) => b.avgEvalScore },
    { label: "Avg Visual Score", key: "avgVisualScore", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true, baselineValue: (b) => b.avgVisualScore },
    { label: "Avg Code Score", key: "avgCodeEvalScore", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true, baselineValue: (b) => b.avgCodeEvalScore },
    { label: "Auto-Approval Rate", key: "autoApprovalRate", format: (v) => v != null ? `${(v * 100).toFixed(1)}%` : "-", higherBetter: true, baselineValue: () => null },
    { label: "Avg Steps", key: "avgSteps", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: false, baselineValue: () => null },
    { label: "Avg Duration", key: "avgDurationMs", format: (v) => v != null ? `${(v / 1000).toFixed(1)}s` : "-", higherBetter: false, baselineValue: (b) => b.avgDurationMs },
    { label: "Avg Cost", key: "avgCostUsd", format: (v) => v != null ? `$${v.toFixed(4)}` : "-", higherBetter: false, baselineValue: (b) => b.avgCostUsd },
    { label: "Total Cost", key: "totalCostUsd", format: (v) => v != null ? `$${v.toFixed(4)}` : "-", higherBetter: false, baselineValue: () => null },
    { label: "Avg LLM Calls", key: "avgLlmCalls", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: false, baselineValue: () => null },
    { label: "Avg Output TPS", key: "avgOutputTps", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true, baselineValue: () => null },
  ];

  const findBest = (key: keyof RunMetrics, baselineVal: number | null, higherBetter: boolean): string | null => {
    const values: Array<{ id: string; val: number }> = [];
    for (const r of runs) {
      const v = r[key] as number | null;
      if (v != null) values.push({ id: r.runId, val: v });
    }
    if (baselineVal != null) values.push({ id: BASELINE_ID, val: baselineVal });
    if (values.length === 0) return null;
    const best = higherBetter
      ? values.reduce((a, b) => (a.val > b.val ? a : b))
      : values.reduce((a, b) => (a.val < b.val ? a : b));
    return best.id;
  };

  const baselineLabel = baseline?.llmModel ? baseline.llmModel.split("/").pop() : "baseline";

  return (
    <SectionCard title="Aggregate Comparison">
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr className="border-b-2 border-[hsl(var(--border))]">
              <th className="p-2 text-left text-[hsl(var(--muted-foreground))]">Metric</th>
              {baseline && (
                <th className="p-2 text-right" style={{ color: BASELINE_COLOR }}>
                  baseline{baselineLabel ? ` (${baselineLabel})` : ""}
                </th>
              )}
              {runs.map((r, i) => (
                <th key={r.runId} className="p-2 text-right" style={{ color: COLORS[i % COLORS.length] }}>
                  {r.modelLabel.split("/").pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const baselineVal = baseline ? m.baselineValue(baseline) : null;
              const bestId = findBest(m.key, baselineVal, m.higherBetter);
              return (
                <tr key={m.key} className="border-b border-[hsl(var(--border)_/_0.4)]">
                  <td className="p-2 font-medium">{m.label}</td>
                  {baseline && (
                    <td className="p-2 text-right" style={{
                      fontWeight: bestId === BASELINE_ID ? 700 : 400,
                      color: bestId === BASELINE_ID ? "hsl(var(--success))" : undefined,
                    }}>
                      {m.format(baselineVal)}
                    </td>
                  )}
                  {runs.map((r) => (
                    <td key={r.runId} className="p-2 text-right" style={{
                      fontWeight: r.runId === bestId ? 700 : 400,
                      color: r.runId === bestId ? "hsl(var(--success))" : undefined,
                    }}>
                      {m.format(r[m.key] as number | null)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ── Comparison Charts ───────────────────────────────────────────────

function ComparisonCharts({ runs, baseline }: { runs: RunMetrics[]; baseline: BaselineMetrics | null }) {
  const BASELINE_COLOR = "#6b7280"; // slate-500

  const runEntries = runs.map((r, i) => ({
    name: r.modelLabel.split("/").pop() ?? r.modelLabel,
    evalScore: r.avgEvalScore ?? 0,
    successRate: (r.successRate ?? 0) * 100,
    avgCost: r.avgCostUsd ?? 0,
    avgDuration: r.avgDurationMs ? r.avgDurationMs / 1000 : 0,
    color: COLORS[i % COLORS.length],
  }));

  const baselineEntry = baseline
    ? [{
        name: `baseline${baseline.llmModel ? ` (${baseline.llmModel.split("/").pop()})` : ""}`,
        evalScore: baseline.avgEvalScore ?? 0,
        successRate: (baseline.successRate ?? 0) * 100,
        avgCost: baseline.avgCostUsd ?? 0,
        avgDuration: baseline.avgDurationMs ? baseline.avgDurationMs / 1000 : 0,
        color: BASELINE_COLOR,
      }]
    : [];

  const chartData = [...baselineEntry, ...runEntries];

  return (
    <SectionCard title="Visual Comparison">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-center text-xs text-[hsl(var(--muted-foreground))]">Avg Eval Score</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(222 47% 14%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 6, color: "hsl(213 31% 91%)" }} />
              <Bar dataKey="evalScore" fill="#2563eb">
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h4 className="mb-2 text-center text-xs text-[hsl(var(--muted-foreground))]">Success Rate (%)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(222 47% 14%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 6, color: "hsl(213 31% 91%)" }} />
              <Bar dataKey="successRate" fill="#16a34a">
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h4 className="mb-2 text-center text-xs text-[hsl(var(--muted-foreground))]">Avg Cost (USD)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(222 47% 14%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 6, color: "hsl(213 31% 91%)" }} />
              <Bar dataKey="avgCost" fill="#d97706">
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <h4 className="mb-2 text-center text-xs text-[hsl(var(--muted-foreground))]">Avg Duration (s)</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(222 47% 14%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 6, color: "hsl(213 31% 91%)" }} />
              <Bar dataKey="avgDuration" fill="#7c3aed">
                {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </SectionCard>
  );
}
