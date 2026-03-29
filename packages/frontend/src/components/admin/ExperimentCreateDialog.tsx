import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  createExperiment,
  updateExperiment,
  listWorkbenchCategories,
  listLlmModels,
  previewPrompts,
  type Experiment,
} from "../../api/experiment.api";

interface Props {
  token: string;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the dialog operates in edit mode with pre-populated values. */
  experiment?: Experiment;
}

export function ExperimentCreateDialog({ token, onClose, onSaved, experiment }: Props) {
  const isEdit = !!experiment;

  const [name, setName] = useState(experiment?.name ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(experiment?.categoryIds ?? []);
  const [promptCount, setPromptCount] = useState(experiment?.promptCount ?? 10);
  const [promptSeed, setPromptSeed] = useState(experiment?.promptSeed ?? 42);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(
    [...new Set(experiment?.runs.map((r) => r.modelId).filter(Boolean) as string[])] ?? [],
  );
  const [selectedFewShotCounts, setSelectedFewShotCounts] = useState<number[]>(
    experiment?.fewShotCounts ?? [],
  );
  const [categories, setCategories] = useState<Array<{ id: string; name: string; promptCount: number; approvedPromptCount: number }>>([]);
  const [models, setModels] = useState<Array<{ id: string; provider: string; modelName: string; displayName: string | null; isActive: boolean }>>([]);
  const [previewedPrompts, setPreviewedPrompts] = useState<Array<{ id: string; prompt: string; index: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      listWorkbenchCategories(token),
      listLlmModels(token),
    ]).then(([cats, mods]) => {
      setCategories(cats);
      setModels(mods.filter((m) => m.isActive));
    }).catch((err) => setError(err.message));
  }, [token]);

  const loadPreview = useCallback(async () => {
    if (selectedCategoryIds.length === 0 || promptCount <= 0) {
      setPreviewedPrompts([]);
      return;
    }
    try {
      const result = await previewPrompts(token, selectedCategoryIds, promptCount, promptSeed);
      setPreviewedPrompts(result);
    } catch {
      setPreviewedPrompts([]);
    }
  }, [token, selectedCategoryIds, promptCount, promptSeed]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const maxPrompts = categories
    .filter((c) => selectedCategoryIds.includes(c.id))
    .reduce((sum, c) => sum + c.approvedPromptCount, 0);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId],
    );
  };

  const toggleModel = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId],
    );
  };

  const toggleFewShotCount = (count: number) => {
    setSelectedFewShotCounts((prev) =>
      prev.includes(count) ? prev.filter((c) => c !== count) : [...prev, count].sort((a, b) => a - b),
    );
  };

  const hasModels = selectedModelIds.length >= 1;
  const totalRuns = selectedModelIds.length * Math.max(selectedFewShotCounts.length, 1);

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (selectedCategoryIds.length === 0) { setError("Select at least one category"); return; }
    if (!hasModels) { setError("Select at least one model"); return; }

    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await updateExperiment(token, experiment.id, {
          name: name.trim(),
          categoryIds: selectedCategoryIds,
          promptCount,
          promptSeed,
          modelIds: selectedModelIds,
          fewShotCounts: selectedFewShotCounts.length > 0 ? selectedFewShotCounts : undefined,
        });
      } else {
        await createExperiment(token, {
          name: name.trim(),
          categoryIds: selectedCategoryIds,
          promptCount,
          promptSeed,
          modelIds: selectedModelIds,
          fewShotCounts: selectedFewShotCounts.length > 0 ? selectedFewShotCounts : undefined,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${isEdit ? "update" : "create"} experiment`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open title={isEdit ? "Edit Experiment" : "New Experiment"} onClose={onClose}>
      {error && (
        <p className="mb-3 text-sm text-[hsl(var(--destructive))]">{error}</p>
      )}

      <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opus vs Sonnet codegen" />
        </div>

        <div>
          <Label>Categories (select 1+)</Label>
          <div className="max-h-[200px] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-2">
            {categories.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-[hsl(var(--muted))]">
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.includes(c.id)}
                  onChange={() => toggleCategory(c.id)}
                  className="accent-[hsl(var(--primary))]"
                />
                <span className="text-sm text-[hsl(var(--foreground))]">
                  {c.name}
                  <span className="ml-1 text-[hsl(var(--muted-foreground))]">
                    ({c.approvedPromptCount} approved / {c.promptCount} total)
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>
              Prompt count{" "}
              {maxPrompts > 0 && <span className="text-[hsl(var(--muted-foreground))]">(max {maxPrompts})</span>}
            </Label>
            <Input type="number" value={promptCount} min={1} max={maxPrompts || 999}
              onChange={(e) => setPromptCount(Math.min(Number(e.target.value), maxPrompts || 999))} />
          </div>
          <div>
            <Label>Seed</Label>
            <Input type="number" value={promptSeed} onChange={(e) => setPromptSeed(Number(e.target.value))} />
          </div>
        </div>

        <div>
          <Label>Models (select 1+ ; need 2+ models or 2+ few-shot counts for comparison)</Label>
          <div className="max-h-[200px] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-2">
            {models.map((m) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-[hsl(var(--muted))]">
                <input
                  type="checkbox"
                  checked={selectedModelIds.includes(m.id)}
                  onChange={() => toggleModel(m.id)}
                  className="accent-[hsl(var(--primary))]"
                />
                <span className="text-sm text-[hsl(var(--foreground))]">
                  {m.provider}/{m.modelName}
                  {m.displayName && <span className="ml-1 text-[hsl(var(--muted-foreground))]">({m.displayName})</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <Label>Few-Shot Example Counts (optional)</Label>
          <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">
            Vary how many workbench examples are injected per run. Leave empty to use the global default.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[0, 1, 2, 3, 5, 6, 10].map((count) => (
              <button
                key={count}
                type="button"
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  selectedFewShotCounts.includes(count)
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
                }`}
                onClick={() => toggleFewShotCount(count)}
              >
                {count === 0 ? "0 (none)" : count}
              </button>
            ))}
          </div>
          {totalRuns > 1 && (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              {totalRuns} runs = {selectedModelIds.length} model{selectedModelIds.length !== 1 ? "s" : ""}
              {selectedFewShotCounts.length > 0 && ` \u00d7 ${selectedFewShotCounts.length} few-shot count${selectedFewShotCounts.length !== 1 ? "s" : ""}`}
              {" \u00d7 "}{promptCount} prompts = {totalRuns * promptCount} generations
            </p>
          )}
        </div>

        {previewedPrompts.length > 0 && (
          <div>
            <Label>Selected prompts preview ({previewedPrompts.length} approved)</Label>
            <div className="max-h-[120px] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-2 text-xs text-[hsl(var(--muted-foreground))]">
              {previewedPrompts.map((p) => (
                <div key={p.id} className="border-b border-[hsl(var(--border)_/_0.3)] py-0.5">
                  #{p.index}: {p.prompt.slice(0, 80)}{p.prompt.length > 80 ? "..." : ""}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting || !hasModels}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Experiment"}
        </Button>
      </div>
    </Dialog>
  );
}
