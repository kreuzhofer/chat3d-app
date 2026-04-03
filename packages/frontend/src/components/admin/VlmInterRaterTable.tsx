/**
 * VLM Inter-Rater Agreement — Pairwise Spearman correlation heatmap.
 */

import type { InterRaterPair } from "../../api/vlm-experiment.api";
import { SectionCard } from "../layout/SectionCard";

interface Props {
  pairs: InterRaterPair[];
}

function corrBgColor(v: number | null): string {
  if (v == null) return "";
  if (v >= 0.8) return "bg-green-100 dark:bg-green-900/30";
  if (v >= 0.6) return "bg-yellow-100 dark:bg-yellow-900/30";
  if (v >= 0.3) return "bg-orange-100 dark:bg-orange-900/30";
  return "bg-red-100 dark:bg-red-900/30";
}

export function VlmInterRaterTable({ pairs }: Props) {
  if (pairs.length === 0) return null;

  return (
    <SectionCard title="Inter-Rater Agreement">
      <div className="overflow-x-auto p-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-[hsl(var(--muted-foreground))]">
              <th className="p-2">Model A</th>
              <th className="p-2">Model B</th>
              <th className="p-2 text-right">Spearman ρ</th>
              <th className="p-2 text-right">Mean |Δ|</th>
              <th className="p-2 text-right">Agreement (±1)</th>
              <th className="p-2 text-right">Paired</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair, i) => (
              <tr key={i} className="border-b border-[hsl(var(--border)_/_0.4)]">
                <td className="p-2 text-[hsl(var(--foreground))]">{pair.runA.label.split("/").pop()}</td>
                <td className="p-2 text-[hsl(var(--foreground))]">{pair.runB.label.split("/").pop()}</td>
                <td className={`p-2 text-right font-mono font-medium ${corrBgColor(pair.spearmanCorrelation)}`}>
                  {pair.spearmanCorrelation != null ? pair.spearmanCorrelation.toFixed(3) : "—"}
                </td>
                <td className="p-2 text-right font-mono text-[hsl(var(--foreground))]">
                  {pair.meanAbsDifference != null ? pair.meanAbsDifference.toFixed(1) : "—"}
                </td>
                <td className="p-2 text-right text-[hsl(var(--foreground))]">
                  {pair.totalPaired > 0
                    ? `${pair.agreementCount}/${pair.totalPaired} (${Math.round((pair.agreementCount / pair.totalPaired) * 100)}%)`
                    : "—"}
                </td>
                <td className="p-2 text-right text-[hsl(var(--muted-foreground))]">{pair.totalPaired}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
