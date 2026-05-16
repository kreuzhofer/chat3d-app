/**
 * Per-prompt bar charts for experiment detail page.
 * Renders three stacked-by-prompt charts: composite score, cost USD, duration s.
 * One bar per (baseline + each run) per prompt. Failed prompts render as gap markers.
 * Layout: horizontal-scroll strip with sticky y-axis + sort toggle.
 */

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../layout/SectionCard";
import type { PromptComparison } from "../../api/experiment.api";

type SortMode = "prompt-index" | "score-desc" | "cost-desc" | "duration-desc";

interface Props {
  data: PromptComparison[];
}

const CLUSTER_WIDTH_PX = 80; // pixels per prompt cluster
const BASELINE_COLOR = "#6b7280";
const RUN_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

// Module-scope helpers — pure functions, no closure over props.

function avgScore(row: PromptComparison): number | null {
  const vals = [row.baseline?.evalScore, ...row.runs.map((r) => r.evalScore)].filter(
    (v): v is number => v != null,
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function avgCost(row: PromptComparison): number | null {
  const vals = [row.baseline?.costUsd, ...row.runs.map((r) => r.costUsd)].filter(
    (v): v is number => v != null,
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function avgDuration(row: PromptComparison): number | null {
  const vals = [row.baseline?.durationMs, ...row.runs.map((r) => r.durationMs)].filter(
    (v): v is number => v != null,
  );
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Chart row shape: one entry per prompt cluster.
type ChartRow = Record<string, number | string | null>;

export function PerPromptBarCharts({ data }: Props) {
  const [sort, setSort] = useState<SortMode>("prompt-index");

  // Collect distinct (runId, shortLabel) pairs across all rows; baseline always first.
  const runOrder = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of data) {
      for (const r of row.runs) {
        if (!seen.has(r.runId)) {
          seen.set(r.runId, r.modelLabel.split("/").pop() ?? r.modelLabel);
        }
      }
    }
    return [...seen.entries()]; // [runId, shortLabel]
  }, [data]);

  const sorted = useMemo(() => {
    const arr = [...data];
    if (sort === "prompt-index") arr.sort((a, b) => a.promptIndex - b.promptIndex);
    else if (sort === "score-desc") arr.sort((a, b) => (avgScore(b) ?? -1) - (avgScore(a) ?? -1));
    else if (sort === "cost-desc") arr.sort((a, b) => (avgCost(b) ?? -1) - (avgCost(a) ?? -1));
    else arr.sort((a, b) => (avgDuration(b) ?? -1) - (avgDuration(a) ?? -1));
    return arr;
  }, [data, sort]);

  // One row in Recharts data = one prompt cluster.
  // Keys: "baseline_score", "baseline_cost", "baseline_duration", "<runId>_score", etc.
  // null values → Recharts renders no bar in that cluster slot (gap marker for failures).
  const chartRows = useMemo<ChartRow[]>(
    () =>
      sorted.map((row) => {
        const out: ChartRow = {
          promptIndex: row.promptIndex,
          label: `#${row.promptIndex}`,
          baseline_score: row.baseline?.evalScore ?? null,
          baseline_cost: row.baseline?.costUsd ?? null,
          baseline_duration:
            row.baseline?.durationMs != null ? row.baseline.durationMs / 1000 : null,
        };
        for (const r of row.runs) {
          out[`${r.runId}_score`] = r.evalScore ?? null;
          out[`${r.runId}_cost`] = r.costUsd ?? null;
          out[`${r.runId}_duration`] = r.durationMs != null ? r.durationMs / 1000 : null;
        }
        return out;
      }),
    [sorted],
  );

  if (data.length === 0) return null;

  const stripWidth = Math.max(chartRows.length * CLUSTER_WIDTH_PX, 600);

  // Thin x-axis tick labels for large prompt counts.
  const tickInterval = Math.max(0, Math.floor(chartRows.length / 25) - 1);

  const metrics = [
    {
      key: "score",
      title: "Composite Score (0–10)",
      yDomain: [0, 10] as [number, number],
      unit: "",
      decimals: 2,
    },
    {
      key: "cost",
      title: "Cost (USD)",
      yDomain: ["auto", "auto"] as ["auto", "auto"],
      unit: "$",
      decimals: 4,
    },
    {
      key: "duration",
      title: "Duration (s)",
      yDomain: ["auto", "auto"] as ["auto", "auto"],
      unit: "s",
      decimals: 2,
    },
  ] as const;

  return (
    <SectionCard title="Per-prompt Bar Charts">
      {/* Sort toggle */}
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-[hsl(var(--muted-foreground))]">Sort:</span>
        {(["prompt-index", "score-desc", "cost-desc", "duration-desc"] as SortMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setSort(mode)}
            className={`rounded px-2 py-0.5 ${
              sort === mode
                ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                : "border border-[hsl(var(--border))]"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: BASELINE_COLOR }}
          />
          baseline
        </span>
        {runOrder.map(([runId, label], i) => (
          <span key={runId} className="flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: RUN_COLORS[i % RUN_COLORS.length] }}
            />
            {label}
          </span>
        ))}
      </div>

      {/* Three stacked charts */}
      {metrics.map((metric) => (
        <div key={metric.key} className="mb-4">
          <h4 className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">{metric.title}</h4>
          <div className="flex">
            {/* Sticky y-axis: a minimal BarChart holding only the YAxis */}
            <div className="shrink-0" style={{ width: 60 }}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={chartRows.slice(0, 1)}
                  margin={{ left: 0, right: 0, top: 4, bottom: 24 }}
                >
                  <YAxis
                    domain={metric.yDomain}
                    tick={{ fontSize: 10, fill: "hsl(213 31% 70%)" }}
                    width={55}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Scrollable bar strip */}
            <div className="overflow-x-auto flex-1">
              <div style={{ width: stripWidth }}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={chartRows}
                    margin={{ left: 0, right: 8, top: 4, bottom: 24 }}
                    barGap={1}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "hsl(213 31% 70%)" }}
                      interval={tickInterval}
                    />
                    <YAxis hide domain={metric.yDomain} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(222 47% 14%)",
                        border: "1px solid hsl(217 33% 22%)",
                        borderRadius: 6,
                        color: "hsl(213 31% 91%)",
                        fontSize: 11,
                      }}
                      formatter={(value: unknown) => {
                        if (value == null) return "—";
                        const num = Number(value);
                        return `${metric.unit}${num.toFixed(metric.decimals)}`;
                      }}
                    />
                    <Bar dataKey={`baseline_${metric.key}`} fill={BASELINE_COLOR} name="baseline" />
                    {runOrder.map(([runId, label], i) => (
                      <Bar
                        key={runId}
                        dataKey={`${runId}_${metric.key}`}
                        fill={RUN_COLORS[i % RUN_COLORS.length]}
                        name={label}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      ))}
    </SectionCard>
  );
}
