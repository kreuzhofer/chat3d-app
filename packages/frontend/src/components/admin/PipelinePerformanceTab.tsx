import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
import { listWorkbenchCategories } from "../../api/experiment.api";
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

function topFailureCategory(breakdown: Record<string, number> | undefined | null): { category: string; count: number } | null {
  if (!breakdown) return null;
  const entries = Object.entries(breakdown);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { category: entries[0][0], count: entries[0][1] };
}

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
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [timeseries, setTimeseries] = useState<PipelineTimeseriesPoint[]>([]);
  const [tools, setTools] = useState<PipelineToolUsageRow[]>([]);
  const [breakdown, setBreakdown] = useState<PipelineBreakdown | null>(null);
  const [angles, setAngles] = useState<DetailViewAngleRow[]>([]);
  const [dvTimeseries, setDvTimeseries] = useState<DetailViewTimeseriesPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const filters = useMemo<PipelineFiltersInput>(() => {
    const range = presetToRange(preset);
    return categoryId ? { ...range, categoryId } : range;
  }, [preset, categoryId]);

  useEffect(() => {
    listWorkbenchCategories(token)
      .then((cats) => setCategories(cats.map(c => ({ id: c.id, name: c.name }))))
      .catch(() => setCategories([]));
  }, [token]);

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
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[{ value: "", label: "All categories" }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
          />
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
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[hsl(var(--border))]">
                  <th className="pb-2 font-medium text-[hsl(var(--muted-foreground))]">Tool</th>
                  <th className="pb-2 text-right font-medium text-[hsl(var(--muted-foreground))]">Calls</th>
                  <th className="pb-2 text-right font-medium text-[hsl(var(--muted-foreground))]">Success Rate</th>
                  <th className="pb-2 text-right font-medium text-[hsl(var(--muted-foreground))]">p50</th>
                  <th className="pb-2 text-right font-medium text-[hsl(var(--muted-foreground))]">p95</th>
                  <th className="pb-2 font-medium text-[hsl(var(--muted-foreground))]">Top Failure</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t) => {
                  const topFailure = topFailureCategory(t.failureBreakdown);
                  const failureCount = t.callCount - t.successCount;
                  const expanded = expandedTool === t.toolName;
                  const hasDetail = (t.recentFailureSamples?.length ?? 0) > 0
                    || Object.keys(t.failureBreakdown ?? {}).length > 0;
                  return (
                    <Fragment key={t.toolName}>
                      <tr
                        className={`border-b border-[hsl(var(--border)/0.3)] ${hasDetail ? "cursor-pointer hover:bg-[hsl(var(--muted)/0.3)]" : ""}`}
                        onClick={() => hasDetail && setExpandedTool(expanded ? null : t.toolName)}
                      >
                        <td className="py-1.5 font-mono">
                          {hasDetail ? <span className="mr-1 text-[hsl(var(--muted-foreground))]">{expanded ? "▼" : "▶"}</span> : <span className="mr-1 inline-block w-3" />}
                          {t.toolName}
                        </td>
                        <td className="py-1.5 text-right">{t.callCount}</td>
                        <td className="py-1.5 text-right">
                          {t.callCount > 0 ? `${((t.successCount / t.callCount) * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="py-1.5 text-right">{t.p50DurationMs > 0 ? formatDuration(t.p50DurationMs) : "—"}</td>
                        <td className="py-1.5 text-right">{t.p95DurationMs > 0 ? formatDuration(t.p95DurationMs) : "—"}</td>
                        <td className="py-1.5">
                          {topFailure ? (
                            <span className="inline-block rounded bg-[hsl(var(--destructive)/0.15)] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--destructive))]">
                              {topFailure.category} ({topFailure.count}/{failureCount})
                            </span>
                          ) : failureCount > 0 ? (
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{failureCount} unclassified</span>
                          ) : (
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">—</span>
                          )}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="border-b border-[hsl(var(--border)/0.3)]">
                          <td colSpan={6} className="bg-[hsl(var(--muted)/0.2)] px-3 py-2 text-[11px]">
                            {Object.keys(t.failureBreakdown ?? {}).length > 0 ? (
                              <div className="mb-2">
                                <span className="text-[hsl(var(--muted-foreground))]">Breakdown: </span>
                                {Object.entries(t.failureBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, cnt]) => (
                                  <span key={cat} className="ml-1 inline-block rounded bg-[hsl(var(--card))] px-1.5 py-0.5 font-mono">
                                    {cat}: {cnt}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {(t.recentFailureSamples ?? []).length > 0 ? (
                              <>
                                <p className="mb-1 text-[hsl(var(--muted-foreground))]">Recent failure samples:</p>
                                <ul className="space-y-1">
                                  {t.recentFailureSamples.map((s, i) => (
                                    <li key={i} className="rounded bg-[hsl(var(--card))] px-2 py-1 font-mono text-[10px] text-[hsl(var(--foreground))]">
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {/* Detail View: timeseries + angle breakdown */}
      {dvTsFormatted.length > 0 ? (
        <SectionCard title="Zoom Follow-ups vs Submissions Over Time">
          <div className="h-56 touch-none">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dvTsFormatted}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip isAnimationActive={false} />
                <Legend />
                <Line type="monotone" dataKey="submitCount" stroke="#3b82f6" name="Submissions" dot={false} />
                <Line type="monotone" dataKey="detailViewCount" stroke="#8b5cf6" name="Zoom Follow-ups" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      ) : null}

      {angles.length > 0 ? (
        <SectionCard title="Zoom Follow-up Angles">
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
  const zoomCalls = tools.find(t => t.toolName === "zoom_followup")?.callCount ?? 0;
  const submitCalls = tools.find(t => t.toolName === "submit_result")?.callCount ?? 0;
  const zoomRate = submitCalls > 0 ? ((zoomCalls / submitCalls) * 100).toFixed(1) : "—";

  return (
    <>
      <p className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">
        Zoom Follow-up Rate: <span className="font-semibold text-[hsl(var(--foreground))]">{zoomRate}%</span>
        <span className="ml-2">({zoomCalls} zoom follow-ups / {submitCalls} submissions)</span>
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
