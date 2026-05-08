import { useCallback, useEffect, useState } from "react";
import {
  getDataQualityReport,
  type DataQualityReport,
  type DataQualityStats,
} from "../../api/admin.api";
import { InlineAlert } from "../layout/InlineAlert";

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function coveragePct(missing: number, total: number): string {
  if (total === 0) return "—";
  return pct(total - missing, total);
}

function cellColor(missing: number, total: number): string {
  if (total === 0) return "";
  const ratio = (total - missing) / total;
  if (ratio >= 0.9) return "text-[hsl(var(--success))]";
  if (ratio >= 0.5) return "text-[hsl(var(--warning))]";
  return "text-[hsl(var(--destructive))]";
}

/** Color for "has" counts (not "missing" — higher is better). */
function hasCellColor(has: number, total: number): string {
  if (total === 0) return "";
  const ratio = has / total;
  if (ratio >= 0.9) return "text-[hsl(var(--success))]";
  if (ratio >= 0.5) return "text-[hsl(var(--warning))]";
  return "text-[hsl(var(--destructive))]";
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4">
      <div className="text-xs text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[hsl(var(--foreground))]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{sub}</div>}
    </div>
  );
}

function StatsRow({ name, stats, linkTo }: { name: string; stats: DataQualityStats; linkTo?: string }) {
  const n = stats.promptsWithExamples;
  const nameEl = linkTo
    ? <a href={linkTo} className="hover:underline text-[hsl(var(--primary))]">{name}</a>
    : <span>{name}</span>;

  return (
    <tr className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)_/_0.1)]">
      <td className="py-2 px-3 text-sm font-medium">{nameEl}</td>
      <td className="py-2 px-3 text-sm text-center">{stats.promptsWithExamples} / {stats.totalPrompts}</td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(n - stats.evalSourceComposite, n)}`}>
        {pct(stats.evalSourceComposite, n)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(stats.missingSpec, stats.totalPrompts)}`}>
        {coveragePct(stats.missingSpec, stats.totalPrompts)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(stats.missingAssertions, stats.totalPrompts)}`}>
        {coveragePct(stats.missingAssertions, stats.totalPrompts)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(n - stats.assertionsRan, n)}`}>
        {pct(stats.assertionsRan, n)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(stats.missingScreenshots, n)}`}>
        {coveragePct(stats.missingScreenshots, n)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(stats.missingVisualScore, n)}`}>
        {coveragePct(stats.missingVisualScore, n)}
      </td>
      <td className="py-2 px-3 text-sm text-center text-[hsl(var(--border))]">|</td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(stats.trainingVlmEval, n)}`}>
        {pct(stats.trainingVlmEval, n)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(stats.trainingCodeReview, n)}`}>
        {pct(stats.trainingCodeReview, n)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(stats.trainingAgentCodegen, n)}`}>
        {pct(stats.trainingAgentCodegen, n)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(stats.trainingSpecGen, stats.totalPrompts)}`}>
        {pct(stats.trainingSpecGen, stats.totalPrompts)}
      </td>
      <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(stats.trainingSpecEnrich, stats.totalPrompts)}`}>
        {pct(stats.trainingSpecEnrich, stats.totalPrompts)}
      </td>
    </tr>
  );
}

export function DataQualityTab({ token }: { token: string }) {
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDataQualityReport(token);
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <InlineAlert tone="info">Loading data quality report...</InlineAlert>;
  if (error) return <InlineAlert tone="danger">{error}</InlineAlert>;
  if (!report) return null;

  const o = report.overall;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Workbench Data Quality</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Total Prompts" value={String(o.totalPrompts)} sub={`${o.promptsWithExamples} with examples`} />
        <SummaryCard
          label="VLM Coverage"
          value={pct(o.evalSourceComposite, o.promptsWithExamples)}
          sub={`${o.evalSourceCodeOnly} code-only, ${o.evalSourceLegacy} legacy`}
        />
        <SummaryCard
          label="Spec Coverage"
          value={coveragePct(o.missingSpec, o.totalPrompts)}
          sub={`${o.totalPrompts - o.missingSpec} / ${o.totalPrompts} prompts`}
        />
        <SummaryCard
          label="Assertions Stored"
          value={coveragePct(o.missingAssertions, o.totalPrompts)}
          sub={`${o.assertionsRan} ran on best examples`}
        />
        <SummaryCard
          label="Training Data"
          value={pct(o.trainingVlmEval + o.trainingCodeReview, o.promptsWithExamples * 2)}
          sub={`VLM: ${o.trainingVlmEval}, Code: ${o.trainingCodeReview}, Agent: ${o.trainingAgentCodegen}, Spec: ${o.trainingSpecGen}`}
        />
      </div>

      {/* Per-category table */}
      <div className="overflow-x-auto rounded-lg border border-[hsl(var(--border))]">
        <table className="w-full text-left">
          <thead className="bg-[hsl(var(--muted)_/_0.2)]">
            <tr>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))]">Category</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center">Prompts</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Best examples with composite, visual_only, or agent_submitted eval source (i.e. VLM ran)">VLM</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Prompts with spec_interpretation">Spec</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Prompts with code_assertions stored">Assert Stored</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Best examples where assertions actually ran">Assert Ran</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Best examples with screenshots">Screenshots</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Best examples with visual_score from VLM">Visual Score</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--border))]">|</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Training data: VLM eval raw response + system prompt">TD: VLM</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Training data: Code review raw response + system prompt">TD: Code</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Training data: Agent conversation + system prompt">TD: Agent</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Training data: Spec generation raw response + system prompt">TD: Spec</th>
              <th className="py-2 px-3 text-xs font-medium text-[hsl(var(--muted-foreground))] text-center" title="Training data: Spec enrichment raw response + system prompt">TD: Enrich</th>
            </tr>
          </thead>
          <tbody>
            {report.categories.map((cat) => (
              <StatsRow
                key={cat.categoryId}
                name={cat.categoryName}
                stats={cat.stats}
                linkTo={`/workbench/${cat.categoryId}`}
              />
            ))}
            <tr className="bg-[hsl(var(--muted)_/_0.1)] font-semibold">
              <td className="py-2 px-3 text-sm">Overall</td>
              <td className="py-2 px-3 text-sm text-center">{o.promptsWithExamples} / {o.totalPrompts}</td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(o.promptsWithExamples - o.evalSourceComposite, o.promptsWithExamples)}`}>
                {pct(o.evalSourceComposite, o.promptsWithExamples)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(o.missingSpec, o.totalPrompts)}`}>
                {coveragePct(o.missingSpec, o.totalPrompts)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(o.missingAssertions, o.totalPrompts)}`}>
                {coveragePct(o.missingAssertions, o.totalPrompts)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(o.promptsWithExamples - o.assertionsRan, o.promptsWithExamples)}`}>
                {pct(o.assertionsRan, o.promptsWithExamples)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(o.missingScreenshots, o.promptsWithExamples)}`}>
                {coveragePct(o.missingScreenshots, o.promptsWithExamples)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${cellColor(o.missingVisualScore, o.promptsWithExamples)}`}>
                {coveragePct(o.missingVisualScore, o.promptsWithExamples)}
              </td>
              <td className="py-2 px-3 text-sm text-center text-[hsl(var(--border))]">|</td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(o.trainingVlmEval, o.promptsWithExamples)}`}>
                {pct(o.trainingVlmEval, o.promptsWithExamples)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(o.trainingCodeReview, o.promptsWithExamples)}`}>
                {pct(o.trainingCodeReview, o.promptsWithExamples)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(o.trainingAgentCodegen, o.promptsWithExamples)}`}>
                {pct(o.trainingAgentCodegen, o.promptsWithExamples)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(o.trainingSpecGen, o.totalPrompts)}`}>
                {pct(o.trainingSpecGen, o.totalPrompts)}
              </td>
              <td className={`py-2 px-3 text-sm text-center font-mono ${hasCellColor(o.trainingSpecEnrich, o.totalPrompts)}`}>
                {pct(o.trainingSpecEnrich, o.totalPrompts)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
