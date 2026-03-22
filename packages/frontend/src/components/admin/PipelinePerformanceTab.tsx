import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  getPipelineSummary,
  getPipelineTimeseries,
  getPipelineToolUsage,
  getPipelineBreakdown,
  getDetailViewAngles,
  getDetailViewTimeseries,
  type PipelineSummary,
  type PipelineTimeseriesPoint,
  type PipelineToolUsageRow,
  type PipelineBreakdown,
  type PipelineFiltersInput,
  type DetailViewAngleRow,
  type DetailViewTimeseriesPoint,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Select } from "../ui/select";

interface Props {
  token: string;
}

const PRESETS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const GRANULARITIES = [
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

function presetToRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  const from = new Date(now);
  if (preset === "24h") from.setHours(from.getHours() - 24);
  else if (preset === "7d") from.setDate(from.getDate() - 7);
  else if (preset === "30d") from.setDate(from.getDate() - 30);
  else from.setDate(from.getDate() - 90);
  return { from: from.toISOString(), to };
}

const PIE_COLORS = ["#3b82f6", "#f59e0b", "#ef4444", "#10b981"];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatBucketLabel(bucket: string, granularity: string): string {
  const d = new Date(bucket);
  if (granularity === "hour") return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (granularity === "week" || granularity === "month") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString();
}

export function PipelinePerformanceTab({ token }: Props) {
  const [preset, setPreset] = useState("7d");
  const [granularity, setGranularity] = useState("day");
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [timeseries, setTimeseries] = useState<PipelineTimeseriesPoint[]>([]);
  const [tools, setTools] = useState<PipelineToolUsageRow[]>([]);
  const [breakdown, setBreakdown] = useState<PipelineBreakdown | null>(null);
  const [angles, setAngles] = useState<DetailViewAngleRow[]>([]);
  const [dvTimeseries, setDvTimeseries] = useState<DetailViewTimeseriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const filters = useMemo<PipelineFiltersInput>(() => presetToRange(preset), [preset]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, ts, t, b, a, dvts] = await Promise.all([
        getPipelineSummary(token, filters),
        getPipelineTimeseries(token, filters, granularity),
        getPipelineToolUsage(token, filters),
        getPipelineBreakdown(token, filters),
        getDetailViewAngles(token, filters),
        getDetailViewTimeseries(token, filters, granularity),
      ]);
      setSummary(s);
      setTimeseries(ts.series);
      setTools(t.tools);
      setBreakdown(b);
      setAngles(a.angles);
      setDvTimeseries(dvts.series);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline data");
    } finally {
      setLoading(false);
    }
  }, [token, filters, granularity]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statusPieData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: "Completed", value: summary.completedCount },
      { name: "Failed", value: summary.failedCount },
      { name: "Aborted", value: summary.abortedCount },
    ].filter(d => d.value > 0);
  }, [summary]);

  const typePieData = useMemo(() => {
    if (!breakdown) return [];
    return [
      { name: "Single Agent", value: breakdown.singleAgentCount },
      { name: "Multi Agent", value: breakdown.multiAgentCount },
    ].filter(d => d.value > 0);
  }, [breakdown]);

  const tsFormatted = useMemo(() => timeseries.map(p => ({
    ...p, label: formatBucketLabel(p.bucket, granularity), failureRatePct: +(p.failureRate * 100).toFixed(1),
  })), [timeseries, granularity]);

  const dvTsFormatted = useMemo(() => dvTimeseries.map(p => ({
    ...p, label: formatBucketLabel(p.bucket, granularity),
  })), [dvTimeseries, granularity]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Pipeline Performance</h2>
        <div className="flex items-center gap-3">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)} options={PRESETS} />
          <Select value={granularity} onChange={(e) => setGranularity(e.target.value)} options={GRANULARITIES} />
        </div>
      </div>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {/* Summary cards */}
      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard label="Total" value={String(summary.totalGenerations)} />
          <SummaryCard label="Avg Steps" value={summary.avgSteps.toFixed(1)} />
          <SummaryCard label="Avg Duration" value={formatDuration(summary.avgDurationMs)} />
          <SummaryCard label="Avg Cost" value={`$${summary.avgCostUsd.toFixed(4)}`} />
          <SummaryCard label="Failure Rate" value={`${(summary.failureRate * 100).toFixed(1)}%`} />
          <SummaryCard label="Avg Eval Score" value={summary.avgEvalScore != null ? summary.avgEvalScore.toFixed(1) : "—"} />
        </div>
      ) : null}

      {/* Charts row 1: Efficiency */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Avg Agent Steps Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip isAnimationActive={false} />
                <Line type="monotone" dataKey="avgSteps" stroke="#3b82f6" name="Avg Steps" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Avg Duration Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatDuration(v)} />
                <Tooltip isAnimationActive={false} formatter={(v: number) => formatDuration(v)} />
                <Line type="monotone" dataKey="avgDurationMs" stroke="#f59e0b" name="Avg Duration" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Avg Cost Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
                <Tooltip isAnimationActive={false} formatter={(v: number) => `$${v.toFixed(4)}`} />
                <Line type="monotone" dataKey="avgCostUsd" stroke="#8b5cf6" name="Avg Cost" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Charts row 2: Quality */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Avg Eval Score Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={tsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 10 }} />
                <Tooltip isAnimationActive={false} />
                <Line type="monotone" dataKey="avgEvalScore" stroke="#10b981" name="Eval Score" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Failure Rate Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                <Tooltip isAnimationActive={false} formatter={(v: number) => `${v}%`} />
                <Bar dataKey="failureRatePct" fill="#ef4444" name="Failure %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Charts row 3: Pie charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Status Breakdown">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {statusPieData.map((_, i) => (
                    <Cell key={i} fill={[PIE_COLORS[3], PIE_COLORS[2], PIE_COLORS[1]][i] ?? PIE_COLORS[0]} />
                  ))}
                </Pie>
                <Tooltip isAnimationActive={false} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="Pipeline Type">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={typePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                  {typePieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i] ?? PIE_COLORS[0]} />
                  ))}
                </Pie>
                <Tooltip isAnimationActive={false} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      {/* Submission stats */}
      {breakdown ? (
        <SectionCard title="Agent Submission">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">Submitted cleanly: </span>
              <span className="font-medium">{breakdown.submittedCount}</span>
            </div>
            <div>
              <span className="text-[hsl(var(--muted-foreground))]">Hit step limit: </span>
              <span className="font-medium">{breakdown.stepLimitCount}</span>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {/* Tool usage table */}
      {tools.length > 0 ? (
        <SectionCard title="Tool Usage">
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="pb-2 font-medium text-[hsl(var(--muted-foreground))]">Tool</th>
                  <th className="pb-2 text-right font-medium text-[hsl(var(--muted-foreground))]">Calls</th>
                  <th className="pb-2 text-right font-medium text-[hsl(var(--muted-foreground))]">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.toolName} className="border-b border-[hsl(var(--border)/0.3)]">
                    <td className="py-1.5 font-mono">{t.toolName}</td>
                    <td className="py-1.5 text-right">{t.callCount}</td>
                    <td className="py-1.5 text-right">
                      {t.callCount > 0 ? `${((t.successCount / t.callCount) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {/* Detail View: timeseries + angle breakdown */}
      {dvTsFormatted.length > 0 ? (
        <SectionCard title="Detail Views vs Submissions Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dvTsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip isAnimationActive={false} />
                <Legend />
                <Bar dataKey="submitCount" fill="#3b82f6" name="Submissions" />
                <Bar dataKey="detailViewCount" fill="#8b5cf6" name="Detail Views" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      ) : null}

      {angles.length > 0 ? (
        <SectionCard title="Detail View Angles">
          <DetailViewAngleChart angles={angles} tools={tools} />
        </SectionCard>
      ) : null}

      {loading ? (
        <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">Loading...</p>
      ) : null}
    </div>
  );
}

function DetailViewAngleChart({ angles, tools }: { angles: DetailViewAngleRow[]; tools: PipelineToolUsageRow[] }) {
  const detailViewCalls = tools.find(t => t.toolName === "request_detail_view")?.callCount ?? 0;
  const submitCalls = tools.find(t => t.toolName === "submit_result")?.callCount ?? 0;
  const detailViewRate = submitCalls > 0 ? ((detailViewCalls / submitCalls) * 100).toFixed(1) : "—";

  return (
    <>
      <p className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">
        Detail View Rate: <span className="font-semibold text-[hsl(var(--foreground))]">{detailViewRate}%</span>
        <span className="ml-2">({detailViewCalls} detail views / {submitCalls} submissions)</span>
      </p>
      <div className="h-48 touch-none">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={angles} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="angle" tick={{ fontSize: 11 }} width={60} />
            <Tooltip isAnimationActive={false} />
            <Bar dataKey="callCount" fill="#8b5cf6" name="Calls" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
      <p className="text-[10px] font-medium uppercase text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
