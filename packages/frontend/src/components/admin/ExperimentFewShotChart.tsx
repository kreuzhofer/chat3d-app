/**
 * Line chart showing eval score vs. few-shot count, one line per model.
 * Only renders when the experiment has fewShotCounts configured.
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { RunMetrics } from "../../api/experiment.api";
import { colorFor } from "./experiment-colors";

interface Props {
  runs: RunMetrics[];
  colorMap: Map<string, string>;
}

export function ExperimentFewShotChart({ runs, colorMap }: Props) {
  const hasFewShot = runs.some((r) => r.fewShotCount != null);
  if (!hasFewShot) return null;

  // Group runs by base model (strip the "(N ex)" suffix). Insertion order
  // follows the (already-sorted) runs list, so few-shot lines render in the
  // same order as everywhere else.
  const modelMap = new Map<string, RunMetrics[]>();
  for (const r of runs) {
    const baseModel = r.modelLabel.replace(/\s*\(\d+ ex\)$/, "");
    if (!modelMap.has(baseModel)) modelMap.set(baseModel, []);
    modelMap.get(baseModel)!.push(r);
  }

  const models = [...modelMap.keys()];
  // Color a base-model line with the color of its first variant (e.g. the
  // 0-ex run). Consistent with the per-prompt charts that color each variant
  // individually — same color appears here for the merged line.
  const lineColor = (baseModel: string) => colorFor(colorMap, modelMap.get(baseModel)![0].modelLabel);
  const allCounts = [...new Set(runs.map((r) => r.fewShotCount).filter((c): c is number => c != null))].sort((a, b) => a - b);

  // Build chart data: one row per few-shot count, columns per model
  const evalData = allCounts.map((count) => {
    const point: Record<string, number | string | null> = { fewShotCount: count };
    for (const model of models) {
      const run = modelMap.get(model)!.find((r) => r.fewShotCount === count);
      point[model] = run?.avgEvalScore ?? null;
    }
    return point;
  });

  const successData = allCounts.map((count) => {
    const point: Record<string, number | string | null> = { fewShotCount: count };
    for (const model of models) {
      const run = modelMap.get(model)!.find((r) => r.fewShotCount === count);
      point[model] = run ? Math.round(run.successRate * 100) : null;
    }
    return point;
  });

  const costData = allCounts.map((count) => {
    const point: Record<string, number | string | null> = { fewShotCount: count };
    for (const model of models) {
      const run = modelMap.get(model)!.find((r) => r.fewShotCount === count);
      point[model] = run?.avgCostUsd ?? null;
    }
    return point;
  });

  const tpsData = allCounts.map((count) => {
    const point: Record<string, number | string | null> = { fewShotCount: count };
    for (const model of models) {
      const run = modelMap.get(model)!.find((r) => r.fewShotCount === count);
      point[model] = run?.avgOutputTps ?? null;
    }
    return point;
  });

  const shortLabel = (model: string) => model.split("/").pop() ?? model;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Few-Shot Curves</h3>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
          <p className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">Avg Eval Score</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={evalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="fewShotCount" tick={{ fontSize: 12 }} label={{ value: "Examples", position: "insideBottom", offset: -5, fontSize: 11 }} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend formatter={shortLabel} />
              {models.map((model, i) => (
                <Line key={model} type="monotone" dataKey={model} name={model} stroke={lineColor(model)} strokeWidth={2} dot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
          <p className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">Success Rate (%)</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={successData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="fewShotCount" tick={{ fontSize: 12 }} label={{ value: "Examples", position: "insideBottom", offset: -5, fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend formatter={shortLabel} />
              {models.map((model, i) => (
                <Line key={model} type="monotone" dataKey={model} name={model} stroke={lineColor(model)} strokeWidth={2} dot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
          <p className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">Avg Cost (USD)</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="fewShotCount" tick={{ fontSize: 12 }} label={{ value: "Examples", position: "insideBottom", offset: -5, fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend formatter={shortLabel} />
              {models.map((model, i) => (
                <Line key={model} type="monotone" dataKey={model} name={model} stroke={lineColor(model)} strokeWidth={2} dot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-3">
          <p className="mb-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">Avg Output TPS</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={tpsData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 33% 22%)" />
              <XAxis dataKey="fewShotCount" tick={{ fontSize: 12 }} label={{ value: "Examples", position: "insideBottom", offset: -5, fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend formatter={shortLabel} />
              {models.map((model, i) => (
                <Line key={model} type="monotone" dataKey={model} name={model} stroke={lineColor(model)} strokeWidth={2} dot={{ r: 4 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
