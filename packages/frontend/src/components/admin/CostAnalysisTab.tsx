import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
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
  getUsageSummary,
  getUsageTimeseries,
  exportUsageData,
  type UsageSummary,
  type TimeseriesResponse,
  type UsageFiltersInput,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Button } from "../ui/button";
import { Select } from "../ui/select";

interface CostAnalysisTabProps {
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

const GROUP_BY_OPTIONS = [
  { value: "", label: "No grouping" },
  { value: "model", label: "Model" },
  { value: "provider", label: "Provider" },
  { value: "purpose", label: "Purpose" },
  { value: "source", label: "Source" },
  { value: "user", label: "User" },
];

const SOURCE_FILTER_OPTIONS = [
  { value: "", label: "All Sources" },
  { value: "workbench", label: "Workbench" },
  { value: "chat", label: "Chat" },
  { value: "experiment", label: "Experiment" },
  { value: "system", label: "System" },
];

const CHART_TYPES = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
];

const COLORS = [
  "hsl(210, 80%, 55%)",
  "hsl(150, 60%, 45%)",
  "hsl(30, 90%, 55%)",
  "hsl(280, 60%, 55%)",
  "hsl(0, 70%, 55%)",
  "hsl(180, 50%, 45%)",
  "hsl(60, 80%, 45%)",
  "hsl(330, 60%, 55%)",
  "hsl(240, 60%, 65%)",
  "hsl(120, 50%, 40%)",
  "hsl(15, 80%, 50%)",
  "hsl(300, 50%, 50%)",
  "hsl(195, 70%, 45%)",
  "hsl(45, 90%, 48%)",
  "hsl(265, 50%, 45%)",
  "hsl(345, 70%, 50%)",
  "hsl(170, 60%, 38%)",
  "hsl(75, 60%, 42%)",
  "hsl(220, 50%, 45%)",
  "hsl(10, 60%, 45%)",
];

function presetToDateRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  const ms: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
    "90d": 90 * 24 * 60 * 60 * 1000,
  };
  const from = new Date(now.getTime() - (ms[preset] ?? ms["7d"])).toISOString();
  return { from, to };
}

function formatCost(value: number): string {
  if (value < 0.01) return `$${value.toFixed(6)}`;
  if (value < 1) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatBucket(isoString: string, granularity: string): string {
  const d = new Date(isoString);
  if (granularity === "hour") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  if (granularity === "day") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (granularity === "week") {
    return `W${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

export function CostAnalysisTab({ token }: CostAnalysisTabProps) {
  const [preset, setPreset] = useState("7d");
  const [granularity, setGranularity] = useState("day");
  const [groupBy, setGroupBy] = useState("");
  const [chartType, setChartType] = useState("bar");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters: UsageFiltersInput = useMemo(() => ({
    ...presetToDateRange(preset),
    ...(sourceFilter ? { source: sourceFilter } : {}),
  }), [preset, sourceFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, tsData] = await Promise.all([
        getUsageSummary(token, filters),
        getUsageTimeseries(token, filters, granularity, groupBy || undefined),
      ]);
      setSummary(summaryData);
      setTimeseries(tsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [token, filters, granularity, groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      setExporting(true);
      try {
        await exportUsageData(token, filters, format);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    },
    [token, filters],
  );

  // Transform timeseries data for recharts
  const chartData = useMemo(() => {
    if (!timeseries) return [];

    if (!groupBy) {
      return timeseries.series.map((p) => ({
        name: formatBucket(p.bucket, granularity),
        cost: p.cost,
      }));
    }

    // Group by: pivot data so each bucket has keys for each group
    const bucketMap = new Map<string, Record<string, number>>();
    const groups = new Set<string>();
    for (const p of timeseries.series) {
      const key = formatBucket(p.bucket, granularity);
      const group = p.group ?? "unknown";
      groups.add(group);
      if (!bucketMap.has(key)) bucketMap.set(key, {});
      const entry = bucketMap.get(key)!;
      entry[group] = (entry[group] ?? 0) + p.cost;
    }

    return Array.from(bucketMap.entries()).map(([key, values]) => ({
      name: key,
      ...values,
    }));
  }, [timeseries, groupBy, granularity]);

  const groupKeys = useMemo(() => {
    if (!groupBy || !timeseries) return [];
    const keys = new Set<string>();
    for (const p of timeseries.series) {
      keys.add(p.group ?? "unknown");
    }
    return Array.from(keys).sort();
  }, [timeseries, groupBy]);

  // Pie chart data
  const pieData = useMemo(() => {
    if (!groupBy || !timeseries) return [];
    const totals = new Map<string, number>();
    for (const p of timeseries.series) {
      const g = p.group ?? "unknown";
      totals.set(g, (totals.get(g) ?? 0) + p.cost);
    }
    return Array.from(totals.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [timeseries, groupBy]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <SectionCard title="Filters">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Date Range
            </label>
            <Select
              options={PRESETS}
              value={preset}
              onChange={(e) => setPreset(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Granularity
            </label>
            <Select
              options={GRANULARITIES}
              value={granularity}
              onChange={(e) => setGranularity(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Group By
            </label>
            <Select
              options={GROUP_BY_OPTIONS}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Source
            </label>
            <Select
              options={SOURCE_FILTER_OPTIONS}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[hsl(var(--muted-foreground))]">
              Chart Type
            </label>
            <Select
              options={CHART_TYPES}
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Download className="h-3.5 w-3.5" />}
              disabled={exporting}
              onClick={() => void handleExport("csv")}
            >
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              iconLeft={<Download className="h-3.5 w-3.5" />}
              disabled={exporting}
              onClick={() => void handleExport("json")}
            >
              JSON
            </Button>
          </div>
        </div>
      </SectionCard>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {loading ? <InlineAlert tone="info">Loading usage data...</InlineAlert> : null}

      {/* Summary cards */}
      {summary ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <SummaryCard label="Total Cost" value={formatCost(summary.totalCost)} />
          <SummaryCard label="Requests" value={String(summary.totalRequests)} />
          <SummaryCard label="Avg Cost/Req" value={formatCost(summary.avgCostPerRequest)} />
          <SummaryCard label="Input Tokens" value={formatTokens(summary.totalInputTokens)} />
          <SummaryCard label="Output Tokens" value={formatTokens(summary.totalOutputTokens)} />
        </div>
      ) : null}

      {/* Chart */}
      {timeseries && chartData.length > 0 ? (
        <SectionCard title="Cost Over Time">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === "pie" && groupBy ? (
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={120}
                    label={({ name, value }) => `${name}: ${formatCost(value)}`}
                  >
                    {pieData.map((_entry, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCost(value)} />
                  <Legend />
                </PieChart>
              ) : chartType === "line" ? (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatCost} />
                  <Tooltip formatter={(value: number) => formatCost(value)} />
                  <Legend />
                  {groupBy ? (
                    groupKeys.map((key, i) => (
                      <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                    ))
                  ) : (
                    <Line type="monotone" dataKey="cost" stroke={COLORS[0]} strokeWidth={2} dot={false} name="Cost" />
                  )}
                </LineChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={formatCost} />
                  <Tooltip formatter={(value: number) => formatCost(value)} />
                  <Legend />
                  {groupBy ? (
                    groupKeys.map((key, i) => (
                      <Bar key={key} dataKey={key} stackId="cost" fill={COLORS[i % COLORS.length]} />
                    ))
                  ) : (
                    <Bar dataKey="cost" fill={COLORS[0]} name="Cost" />
                  )}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </SectionCard>
      ) : !loading ? (
        <SectionCard title="Cost Over Time">
          <p className="py-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No usage data for the selected period.
          </p>
        </SectionCard>
      ) : null}

      {/* Token breakdown if summary available */}
      {summary && summary.totalRequests > 0 ? (
        <SectionCard title="Token Breakdown">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="Reasoning" value={formatTokens(summary.totalReasoningTokens)} />
            <SummaryCard label="Cache Read" value={formatTokens(summary.totalCacheReadTokens)} />
            <SummaryCard label="Cache Write" value={formatTokens(summary.totalCacheWriteTokens)} />
            <SummaryCard label="Avg Input/Req" value={formatTokens(summary.avgInputTokensPerRequest)} />
            <SummaryCard label="Avg Output/Req" value={formatTokens(summary.avgOutputTokensPerRequest)} />
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-3">
      <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{value}</p>
    </div>
  );
}
