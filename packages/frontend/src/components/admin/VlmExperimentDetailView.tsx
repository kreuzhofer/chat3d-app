import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  getVlmExperiment,
  getVlmExperimentStatus,
  getVlmComparison,
  getVlmPerExampleComparison,
  getVlmInterRaterAgreement,
  startVlmExperiment,
  cancelVlmExperiment,
  rerunVlmExperiment,
  resetVlmExperimentRun,
  deleteVlmExperiment,
  type VlmExperiment,
  type VlmExperimentStatus,
  type VlmRunMetrics,
  type VlmExampleComparison,
  type InterRaterPair,
} from "../../api/vlm-experiment.api";
import { VlmCorrelationSummary } from "./VlmCorrelationSummary";
import { VlmInterRaterTable } from "./VlmInterRaterTable";
import { VlmPerExampleTable } from "./VlmPerExampleTable";
import { VlmExperimentCreateDialog } from "./VlmExperimentCreateDialog";

interface Props {
  token: string;
  experimentId: string;
  onBack: () => void;
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

export function VlmExperimentDetailView({ token, experimentId, onBack }: Props) {
  const [experiment, setExperiment] = useState<VlmExperiment | null>(null);
  const [comparison, setComparison] = useState<VlmRunMetrics[] | null>(null);
  const [exampleData, setExampleData] = useState<VlmExampleComparison[] | null>(null);
  const [interRater, setInterRater] = useState<InterRaterPair[] | null>(null);
  const [status, setStatus] = useState<VlmExperimentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const exp = await getVlmExperiment(token, experimentId);
      setExperiment(exp);
      // Load comparison data for any non-created status (including running)
      if (exp.status !== "created") {
        const [comp, examples, rater] = await Promise.all([
          getVlmComparison(token, experimentId),
          getVlmPerExampleComparison(token, experimentId),
          getVlmInterRaterAgreement(token, experimentId),
        ]);
        setComparison(comp.runs);
        setExampleData(examples);
        setInterRater(rater.pairs);
      }
      if (exp.status === "running") {
        const st = await getVlmExperimentStatus(token, experimentId);
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
        const [st, comp, examples, rater] = await Promise.all([
          getVlmExperimentStatus(token, experimentId),
          getVlmComparison(token, experimentId),
          getVlmPerExampleComparison(token, experimentId),
          getVlmInterRaterAgreement(token, experimentId),
        ]);
        setStatus(st);
        setComparison(comp.runs);
        setExampleData(examples);
        setInterRater(rater.pairs);
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

      <VlmExperimentHeader
        experiment={experiment}
        status={status}
        token={token}
        onRefresh={load}
        setError={setError}
        onBack={onBack}
      />

      {error && <InlineAlert variant="error" message={error} />}

      {experiment.status === "running" && status && (
        <RunProgressSection status={status} exampleCount={experiment.promptCount} />
      )}

      {comparison && comparison.length > 0 && (
        <>
          <VlmCorrelationSummary runs={comparison} />
          {interRater && interRater.length > 0 && (
            <VlmInterRaterTable pairs={interRater} />
          )}
          {exampleData && exampleData.length > 0 && (
            <VlmPerExampleTable examples={exampleData} />
          )}
        </>
      )}
    </div>
  );
}

// -- Progress Bar -------------------------------------------------------------

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

function RunProgressSection({ status, exampleCount }: { status: VlmExperimentStatus; exampleCount: number }) {
  const totalCompleted = status.runs.reduce((sum, r) => sum + r.completedExamples, 0);
  const totalExpected = status.runs.length * exampleCount;
  const overallPct = totalExpected > 0 ? Math.round((totalCompleted / totalExpected) * 100) : 0;

  return (
    <SectionCard title={`Progress — ${overallPct}%`}>
      <div className="mb-3">
        <ProgressBar value={totalCompleted} max={totalExpected} />
      </div>
      <div className="space-y-2">
        {status.runs.map((r, i) => {
          const pct = exampleCount > 0 ? Math.round((r.completedExamples / exampleCount) * 100) : 0;
          return (
            <div key={r.runId} className="flex items-center gap-3">
              <Badge
                variant={r.status === "running" ? "default" : r.status === "completed" ? "secondary" : "outline"}
                className="w-20 justify-center text-[0.65rem]"
              >
                {r.status}
              </Badge>
              <span className="w-40 truncate text-sm">{r.modelLabel.split("/").pop()}</span>
              <div className="flex-1">
                <ProgressBar value={r.completedExamples} max={exampleCount} color={COLORS[i % COLORS.length]} />
              </div>
              <span className="w-24 text-right text-xs text-[hsl(var(--muted-foreground))]">
                {r.completedExamples}/{exampleCount} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

// -- Header -------------------------------------------------------------------

function VlmExperimentHeader({ experiment, status, token, onRefresh, setError, onBack }: {
  experiment: VlmExperiment;
  status: VlmExperimentStatus | null;
  token: string;
  onRefresh: () => void;
  setError: (e: string | null) => void;
  onBack: () => void;
}) {
  const [showEditDialog, setShowEditDialog] = useState(false);
  const canEdit = experiment.status !== "running";
  const canStart = experiment.status === "created";
  const canCancel = experiment.status === "running";
  const canRerun = ["completed", "failed", "cancelled"].includes(experiment.status);
  const canDelete = experiment.status !== "running";

  return (
    <SectionCard title={experiment.name}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <div><strong>Type:</strong> VLM Comparison</div>
        <div><strong>Examples:</strong> {experiment.promptCount} (seed: {experiment.promptSeed})</div>
        <div>
          <strong>Status:</strong>{" "}
          <Badge variant={experiment.status === "running" ? "default" : "secondary"}>
            {experiment.status}
          </Badge>
        </div>
        <div><strong>Runs:</strong> {experiment.runs.length}</div>
        <div><strong>Created:</strong> {new Date(experiment.createdAt).toLocaleDateString()}</div>
        {experiment.startedAt && (
          <div><strong>Started:</strong> {new Date(experiment.startedAt).toLocaleString()}</div>
        )}
        {experiment.completedAt && (
          <div><strong>Completed:</strong> {new Date(experiment.completedAt).toLocaleString()}</div>
        )}
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <strong>Models:</strong>
        {experiment.runs.map((r, i) => (
          <span key={r.id} className="inline-flex items-center gap-1">
            <Badge
              style={{
                backgroundColor: COLORS[i % COLORS.length] + "22",
                color: COLORS[i % COLORS.length],
              }}
            >
              {r.modelLabel} ({r.status})
            </Badge>
            {canEdit && r.status === "completed" && (
              <button
                className="cursor-pointer rounded border-none bg-transparent px-1 text-[0.6rem] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                title="Reset this run's results"
                onClick={async () => {
                  if (!window.confirm(`Reset results for ${r.modelLabel}? This will delete its results and allow re-running.`)) return;
                  try { await resetVlmExperimentRun(token, experiment.id, r.id); onRefresh(); }
                  catch (e) { setError((e as Error).message); }
                }}
              >
                reset
              </button>
            )}
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setShowEditDialog(true)}>
            Edit
          </Button>
        )}
        {canStart && (
          <Button size="sm" onClick={async () => {
            try { await startVlmExperiment(token, experiment.id); onRefresh(); }
            catch (e) { setError((e as Error).message); }
          }}>
            Start Experiment
          </Button>
        )}
        {canCancel && (
          <Button size="sm" variant="outline" onClick={async () => {
            try { await cancelVlmExperiment(token, experiment.id); onRefresh(); }
            catch (e) { setError((e as Error).message); }
          }}>
            Cancel
          </Button>
        )}
        {canRerun && (
          <Button size="sm" variant="outline" onClick={async () => {
            if (!window.confirm("Re-run this experiment? This will delete all existing results and start fresh.")) return;
            try { await rerunVlmExperiment(token, experiment.id); onRefresh(); }
            catch (e) { setError((e as Error).message); }
          }}>
            Re-run All
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="outline" onClick={async () => {
            if (!window.confirm("Delete this experiment and all its results? This cannot be undone.")) return;
            try { await deleteVlmExperiment(token, experiment.id); onBack(); }
            catch (e) { setError((e as Error).message); }
          }}>
            Delete
          </Button>
        )}
      </div>

      {showEditDialog && (
        <VlmExperimentCreateDialog
          token={token}
          experiment={experiment}
          onClose={() => setShowEditDialog(false)}
          onSaved={() => { setShowEditDialog(false); onRefresh(); }}
        />
      )}
    </SectionCard>
  );
}
