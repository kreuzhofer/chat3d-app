import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  listExperiments,
  deleteExperiment,
  startExperiment,
  cancelExperiment,
  rerunExperiment,
  getExperiment,
  type ExperimentListItem,
} from "../../api/experiment.api";
import { getVlmExperiment } from "../../api/vlm-experiment.api";
import { ExperimentCreateDialog } from "./ExperimentCreateDialog";
import { ExperimentDetailView } from "./ExperimentDetailView";
import { VlmExperimentsTab } from "./VlmExperimentsTab";

interface Props {
  token: string;
  selectedExperimentId?: string;
}

type TabType = "codegen" | "vlm";

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  created: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

export function ExperimentsTab({ token, selectedExperimentId }: Props) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>("codegen");
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<ExperimentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // When viewing a detail, detect the experiment type to route to the right component
  useEffect(() => {
    if (!selectedExperimentId) { setDetectedType(null); return; }
    let cancelled = false;
    (async () => {
      try {
        // Try VLM first (lightweight check)
        const vlm = await getVlmExperiment(token, selectedExperimentId);
        if (!cancelled && vlm.type === "vlm_comparison") { setDetectedType("vlm_comparison"); return; }
      } catch { /* not a VLM experiment */ }
      try {
        const exp = await getExperiment(token, selectedExperimentId);
        if (!cancelled) setDetectedType(exp.type ?? "codegen");
      } catch {
        if (!cancelled) setDetectedType("codegen");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedExperimentId, token]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listExperiments(token);
      setExperiments(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load experiments");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const hasRunning = experiments.some((e) => e.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [experiments, refresh]);

  const handleStart = async (id: string) => {
    try { await startExperiment(token, id); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to start experiment"); }
  };

  const handleCancel = async (id: string) => {
    try { await cancelExperiment(token, id); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to cancel experiment"); }
  };

  const handleRerun = async (id: string) => {
    if (!window.confirm("Re-run this experiment? This will delete all existing results and start fresh.")) return;
    try { await rerunExperiment(token, id); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to re-run experiment"); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this experiment and all its results?")) return;
    try {
      await deleteExperiment(token, id);
      if (selectedExperimentId === id) navigate("/admin/experiments");
      refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to delete experiment"); }
  };

  // Detail view — route to the right component based on experiment type
  if (selectedExperimentId) {
    if (detectedType === "vlm_comparison") {
      return <VlmExperimentsTab token={token} selectedExperimentId={selectedExperimentId} />;
    }
    if (detectedType) {
      return (
        <ExperimentDetailView
          token={token}
          experimentId={selectedExperimentId}
          onBack={() => { navigate("/admin/experiments"); refresh(); }}
        />
      );
    }
    return <div className="p-4 text-[hsl(var(--muted-foreground))]">Loading...</div>;
  }

  // Tab bar + list view
  const tabClass = (tab: TabType) =>
    `px-4 py-2 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
      activeTab === tab
        ? "border-[hsl(var(--primary))] text-[hsl(var(--primary))]"
        : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
    }`;

  return (
    <div className="p-4">
      <div className="mb-4 flex gap-4 border-b border-[hsl(var(--border))]">
        <button className={tabClass("codegen")} onClick={() => setActiveTab("codegen")}>Codegen</button>
        <button className={tabClass("vlm")} onClick={() => setActiveTab("vlm")}>VLM Comparison</button>
      </div>

      {activeTab === "vlm" ? (
        <VlmExperimentsTab token={token} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">LLM Experiments</h2>
            <Button onClick={() => setShowCreate(true)}>New Experiment</Button>
          </div>

          {error && <InlineAlert variant="error" message={error} />}

          <SectionCard title="Experiments">
            {loading && experiments.length === 0 ? (
              <p className="p-4 text-[hsl(var(--muted-foreground))]">Loading...</p>
            ) : experiments.length === 0 ? (
              <p className="p-4 text-[hsl(var(--muted-foreground))]">No experiments yet. Create one to compare LLM models.</p>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] text-left text-[hsl(var(--muted-foreground))]">
                    <th className="p-2">Name</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Purpose</th>
                    <th className="p-2">Prompts</th>
                    <th className="p-2">Runs</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {experiments.map((exp) => (
                    <tr key={exp.id} className="border-b border-[hsl(var(--border)_/_0.4)]">
                      <td className="p-2">
                        <button
                          onClick={() => navigate(`/admin/experiments/${exp.id}`)}
                          className="cursor-pointer border-none bg-transparent p-0 text-[hsl(var(--primary))] underline"
                        >
                          {exp.name}
                        </button>
                      </td>
                      <td className="p-2">{exp.categoryNames.join(", ")}</td>
                      <td className="p-2"><code className="text-xs">{exp.testedPurpose}</code></td>
                      <td className="p-2">{exp.promptCount}</td>
                      <td className="p-2">
                        {exp.runs.map((r) => (
                          <Badge key={r.id} variant={STATUS_COLORS[r.status] ?? "outline"} className="mr-1 text-[0.7rem]">
                            {r.modelLabel.split("/").pop()}
                          </Badge>
                        ))}
                      </td>
                      <td className="p-2">
                        <Badge variant={STATUS_COLORS[exp.status] ?? "outline"}>{exp.status}</Badge>
                      </td>
                      <td className="whitespace-nowrap p-2">
                        {exp.status !== "running" && (exp.status === "created" || exp.runs.some((r) => r.status === "pending")) && (
                          <Button size="sm" variant="default" onClick={() => handleStart(exp.id)} className="mr-1">
                            {exp.status === "created" ? "Start" : "Continue"}
                          </Button>
                        )}
                        {exp.status === "running" && (
                          <Button size="sm" variant="outline" onClick={() => handleCancel(exp.id)} className="mr-1">Cancel</Button>
                        )}
                        {["completed", "failed", "cancelled"].includes(exp.status) && (
                          <Button size="sm" variant="outline" onClick={() => handleRerun(exp.id)} className="mr-1">Re-run</Button>
                        )}
                        {exp.status !== "running" && (
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(exp.id)}>Delete</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </SectionCard>

          {showCreate && (
            <ExperimentCreateDialog
              token={token}
              onClose={() => setShowCreate(false)}
              onSaved={() => { setShowCreate(false); refresh(); }}
            />
          )}
        </>
      )}
    </div>
  );
}
