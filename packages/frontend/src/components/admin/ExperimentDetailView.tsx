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
  startExperiment,
  cancelExperiment,
  type Experiment,
  type RunMetrics,
  type ExperimentStatus,
} from "../../api/experiment.api";
import { ExperimentPromptComparisonTable } from "./ExperimentPromptComparisonTable";

interface Props {
  token: string;
  experimentId: string;
  onBack: () => void;
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

export function ExperimentDetailView({ token, experimentId, onBack }: Props) {
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [comparison, setComparison] = useState<RunMetrics[] | null>(null);
  const [status, setStatus] = useState<ExperimentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const exp = await getExperiment(token, experimentId);
      setExperiment(exp);
      if (exp.status === "completed" || exp.status === "failed") {
        const comp = await getExperimentComparison(token, experimentId);
        setComparison(comp.runs);
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
        const st = await getExperimentStatus(token, experimentId);
        setStatus(st);
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

      <ExperimentHeader experiment={experiment} status={status} token={token} onRefresh={load} setError={setError} />

      {error && <InlineAlert variant="error" message={error} />}

      {experiment.status === "running" && status && (
        <SectionCard title="Progress">
          {status.runs.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1">
              <Badge variant={r.status === "running" ? "default" : r.status === "completed" ? "secondary" : "outline"}>
                {r.status}
              </Badge>
              <span className="text-sm">{r.modelLabel}</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                ({r.completedPrompts}/{experiment.promptCount} prompts)
              </span>
            </div>
          ))}
        </SectionCard>
      )}

      {comparison && comparison.length > 0 && (
        <>
          <ComparisonTable runs={comparison} />
          <ComparisonCharts runs={comparison} />
          <ExperimentPromptComparisonTable token={token} experimentId={experimentId} />
        </>
      )}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function ExperimentHeader({ experiment, status, token, onRefresh, setError }: {
  experiment: Experiment;
  status: ExperimentStatus | null;
  token: string;
  onRefresh: () => void;
  setError: (e: string | null) => void;
}) {
  return (
    <SectionCard title={experiment.name}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <div><strong>Categories:</strong> {experiment.categories.map(c => c.name).join(", ")}</div>
        <div><strong>Purpose:</strong> <code>{experiment.testedPurpose}</code></div>
        <div><strong>Status:</strong> <Badge variant={experiment.status === "running" ? "default" : "secondary"}>{experiment.status}</Badge></div>
        <div><strong>Prompts:</strong> {experiment.promptCount} (seed: {experiment.promptSeed})</div>
        <div><strong>Runs:</strong> {experiment.runs.length}</div>
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

      {experiment.status === "created" && (
        <Button size="sm" onClick={async () => { try { await startExperiment(token, experiment.id); onRefresh(); } catch (e) { setError((e as Error).message); } }}>
          Start Experiment
        </Button>
      )}
      {experiment.status === "running" && (
        <Button size="sm" variant="outline" onClick={async () => { try { await cancelExperiment(token, experiment.id); onRefresh(); } catch (e) { setError((e as Error).message); } }}>
          Cancel
        </Button>
      )}
    </SectionCard>
  );
}

// ── Comparison Table ────────────────────────────────────────────────

function ComparisonTable({ runs }: { runs: RunMetrics[] }) {
  const metrics: Array<{ label: string; key: keyof RunMetrics; format: (v: number | null) => string; higherBetter: boolean }> = [
    { label: "Success Rate", key: "successRate", format: (v) => v != null ? `${(v * 100).toFixed(1)}%` : "-", higherBetter: true },
    { label: "Avg Eval Score", key: "avgEvalScore", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true },
    { label: "Avg Visual Score", key: "avgVisualScore", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true },
    { label: "Avg Code Score", key: "avgCodeEvalScore", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: true },
    { label: "Auto-Approval Rate", key: "autoApprovalRate", format: (v) => v != null ? `${(v * 100).toFixed(1)}%` : "-", higherBetter: true },
    { label: "Avg Steps", key: "avgSteps", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: false },
    { label: "Avg Duration", key: "avgDurationMs", format: (v) => v != null ? `${(v / 1000).toFixed(1)}s` : "-", higherBetter: false },
    { label: "Avg Cost", key: "avgCostUsd", format: (v) => v != null ? `$${v.toFixed(4)}` : "-", higherBetter: false },
    { label: "Total Cost", key: "totalCostUsd", format: (v) => v != null ? `$${v.toFixed(4)}` : "-", higherBetter: false },
    { label: "Avg LLM Calls", key: "avgLlmCalls", format: (v) => v != null ? v.toFixed(1) : "-", higherBetter: false },
  ];

  const findBest = (key: keyof RunMetrics, higherBetter: boolean): string | null => {
    const values = runs.map((r) => ({ id: r.runId, val: r[key] as number | null })).filter((v) => v.val != null);
    if (values.length === 0) return null;
    const best = higherBetter
      ? values.reduce((a, b) => ((a.val ?? 0) > (b.val ?? 0) ? a : b))
      : values.reduce((a, b) => ((a.val ?? Infinity) < (b.val ?? Infinity) ? a : b));
    return best.id;
  };

  return (
    <SectionCard title="Aggregate Comparison">
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr className="border-b-2 border-[hsl(var(--border))]">
              <th className="p-2 text-left text-[hsl(var(--muted-foreground))]">Metric</th>
              {runs.map((r, i) => (
                <th key={r.runId} className="p-2 text-right" style={{ color: COLORS[i % COLORS.length] }}>
                  {r.modelLabel.split("/").pop()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const bestId = findBest(m.key, m.higherBetter);
              return (
                <tr key={m.key} className="border-b border-[hsl(var(--border)_/_0.4)]">
                  <td className="p-2 font-medium">{m.label}</td>
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

function ComparisonCharts({ runs }: { runs: RunMetrics[] }) {
  const chartData = runs.map((r, i) => ({
    name: r.modelLabel.split("/").pop() ?? r.modelLabel,
    evalScore: r.avgEvalScore ?? 0,
    successRate: (r.successRate ?? 0) * 100,
    avgCost: r.avgCostUsd ?? 0,
    avgDuration: r.avgDurationMs ? r.avgDurationMs / 1000 : 0,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <SectionCard title="Visual Comparison">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h4 className="mb-2 text-center text-xs text-[hsl(var(--muted-foreground))]">Avg Eval Score</h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "hsl(213 31% 70%)" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(222 47% 14%)", border: "1px solid hsl(217 33% 22%)", borderRadius: 6, color: "hsl(213 31% 91%)" }} />
              <Bar dataKey="evalScore" fill="#2563eb">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
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
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
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
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
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
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </SectionCard>
  );
}
