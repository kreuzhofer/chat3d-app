import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  RenderErrorCategoryName,
  RenderErrorExample,
  RenderErrorHistogram,
} from "@chat3d/shared";
import {
  getDataQualityReport,
  type CategoryDataQuality,
  type DataQualityStats,
} from "../../api/admin.api";
import { fetchRenderErrorExamples } from "../../api/renderErrors";
import { InlineAlert } from "../layout/InlineAlert";
import { Dialog } from "../ui/dialog";

/**
 * Ordered list of render-error categories displayed in the histogram columns.
 *
 * The shared `DataQualityStats` type does not yet declare the
 * `renderErrorCategoryHistogram` field, even though the backend returns it
 * (see `packages/backend/src/services/data-quality.service.ts`). We narrow it
 * locally rather than widening the shared contract for one consumer.
 */
const CATEGORY_NAMES: RenderErrorCategoryName[] = [
  "kernel_error",
  "geometry",
  "type_error",
  "api_misuse",
  "syntax",
  "infrastructure",
  "unknown",
];

type StatsWithHistogram = DataQualityStats & {
  renderErrorCategoryHistogram?: RenderErrorHistogram;
};

interface DrillDownState {
  categoryId: string;
  categoryName: string;
  errorCategory: RenderErrorCategoryName;
  examples: RenderErrorExample[];
  total: number;
  loading: boolean;
}

function emptyHistogram(): RenderErrorHistogram {
  return {
    infrastructure: 0,
    api_misuse: 0,
    geometry: 0,
    type_error: 0,
    kernel_error: 0,
    syntax: 0,
    unknown: 0,
  };
}

export function RenderErrorsTab({ token }: { token: string }) {
  const [rows, setRows] = useState<CategoryDataQuality[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const report = await getDataQualityReport(token);
      setRows(report.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo<RenderErrorHistogram | null>(() => {
    if (!rows) return null;
    const t = emptyHistogram();
    for (const r of rows) {
      const h = (r.stats as StatsWithHistogram).renderErrorCategoryHistogram;
      if (!h) continue;
      for (const k of CATEGORY_NAMES) t[k] += h[k] ?? 0;
    }
    return t;
  }, [rows]);

  const openDrillDown = useCallback(
    async (categoryId: string, categoryName: string, errorCategory: RenderErrorCategoryName) => {
      setDrillDown({
        categoryId,
        categoryName,
        errorCategory,
        examples: [],
        total: 0,
        loading: true,
      });
      try {
        const resp = await fetchRenderErrorExamples(token, {
          categoryId,
          errorCategory,
          limit: 100,
        });
        setDrillDown({
          categoryId,
          categoryName,
          errorCategory,
          examples: resp.examples,
          total: resp.total,
          loading: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setDrillDown(null);
      }
    },
    [token],
  );

  if (loading) return <InlineAlert tone="info">Loading render errors...</InlineAlert>;
  if (error) return <InlineAlert tone="danger">{error}</InlineAlert>;
  if (!rows) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Render Errors</h2>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Per-workbench-category breakdown of best-example render-error categories. Click a
        non-zero count to drill into the underlying examples.
      </p>

      <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
        <table className="w-full text-left">
          <thead className="bg-[hsl(var(--muted)_/_0.2)]">
            <tr>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Workbench category
              </th>
              {CATEGORY_NAMES.map((c) => (
                <th
                  key={c}
                  className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const h = (row.stats as StatsWithHistogram).renderErrorCategoryHistogram;
              return (
                <tr
                  key={row.categoryId}
                  className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)_/_0.1)]"
                >
                  <td className="py-2 px-3 text-sm font-medium">{row.categoryName}</td>
                  {CATEGORY_NAMES.map((c) => {
                    const count = h?.[c] ?? 0;
                    const clickable = count > 0;
                    return (
                      <td
                        key={c}
                        className={`py-2 px-3 text-sm text-center font-mono ${
                          clickable
                            ? "cursor-pointer text-[hsl(var(--primary))] hover:underline"
                            : "text-[hsl(var(--muted-foreground))]"
                        }`}
                        onClick={
                          clickable
                            ? () => void openDrillDown(row.categoryId, row.categoryName, c)
                            : undefined
                        }
                      >
                        {count}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {totals && (
              <tr className="bg-[hsl(var(--muted)_/_0.1)] font-semibold">
                <td className="py-2 px-3 text-sm">TOTAL</td>
                {CATEGORY_NAMES.map((c) => (
                  <td key={c} className="py-2 px-3 text-sm text-center font-mono">
                    {totals[c]}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog
        open={drillDown !== null}
        title={
          drillDown
            ? `${drillDown.categoryName} — ${drillDown.errorCategory} (${drillDown.total} examples)`
            : ""
        }
        onClose={() => setDrillDown(null)}
      >
        {drillDown?.loading ? (
          <InlineAlert tone="info">Loading examples...</InlineAlert>
        ) : drillDown && drillDown.examples.length === 0 ? (
          <InlineAlert tone="warning">No examples returned.</InlineAlert>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))]">
            {drillDown?.examples.map((ex) => (
              <li key={ex.id} className="py-3">
                <div className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {ex.promptText.length > 160
                    ? `${ex.promptText.slice(0, 160)}…`
                    : ex.promptText}
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-[hsl(var(--muted)_/_0.2)] px-2 py-1 font-mono text-xs text-[hsl(var(--foreground))]">
                  {ex.renderError
                    ? ex.renderError.length > 400
                      ? `${ex.renderError.slice(0, 400)}…`
                      : ex.renderError
                    : "(no message)"}
                </pre>
                {ex.renderErrorDetail ? (
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                    detail: <code>{ex.renderErrorDetail}</code>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}
