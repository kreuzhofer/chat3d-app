import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../layout/SectionCard";
import { InlineAlert } from "../layout/InlineAlert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  listExperiments,
  deleteExperiment,
  startExperiment,
  cancelExperiment,
  type ExperimentListItem,
} from "../../api/experiment.api";
import { ExperimentCreateDialog } from "./ExperimentCreateDialog";
import { ExperimentDetailView } from "./ExperimentDetailView";

interface Props {
  token: string;
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  created: "outline",
  running: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

export function ExperimentsTab({ token }: Props) {
  const [experiments, setExperiments] = useState<ExperimentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Poll for running experiments
  useEffect(() => {
    const hasRunning = experiments.some((e) => e.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [experiments, refresh]);

  const handleStart = async (id: string) => {
    try {
      await startExperiment(token, id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start experiment");
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelExperiment(token, id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel experiment");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this experiment and all its results?")) return;
    try {
      await deleteExperiment(token, id);
      if (selectedId === id) setSelectedId(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete experiment");
    }
  };

  if (selectedId) {
    return (
      <ExperimentDetailView
        token={token}
        experimentId={selectedId}
        onBack={() => { setSelectedId(null); refresh(); }}
      />
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
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
          <table className="w-full border-collapse text-sm">
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
                      onClick={() => setSelectedId(exp.id)}
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
                    {exp.status === "created" && (
                      <Button size="sm" variant="default" onClick={() => handleStart(exp.id)} className="mr-1">
                        Start
                      </Button>
                    )}
                    {exp.status === "running" && (
                      <Button size="sm" variant="outline" onClick={() => handleCancel(exp.id)} className="mr-1">
                        Cancel
                      </Button>
                    )}
                    {exp.status !== "running" && (
                      <Button size="sm" variant="destructive" onClick={() => handleDelete(exp.id)}>
                        Delete
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {showCreate && (
        <ExperimentCreateDialog
          token={token}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </div>
  );
}
