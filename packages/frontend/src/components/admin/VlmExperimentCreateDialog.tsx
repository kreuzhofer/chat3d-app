import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  createVlmExperiment,
  updateVlmExperiment,
  previewVlmExamples,
  listLlmModels,
  listWorkbenchCategories,
  type PreviewExample,
  type VlmExperiment,
} from "../../api/vlm-experiment.api";

interface Props {
  token: string;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, dialog is in edit mode with pre-populated values. */
  experiment?: VlmExperiment;
}

interface VlmModel {
  id: string;
  displayName: string | null;
  modelName: string;
  provider: string;
  supportsVision: boolean;
}

interface Category {
  id: string;
  name: string;
  promptCount: number;
  approvedPromptCount: number;
}

export function VlmExperimentCreateDialog({ token, onClose, onSaved, experiment }: Props) {
  const isEdit = !!experiment;
  const [name, setName] = useState(experiment?.name ?? "");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(experiment?.categoryIds ?? []);
  const [exampleCount, setExampleCount] = useState(experiment?.promptCount ?? 10);
  const [exampleSeed, setExampleSeed] = useState(experiment?.promptSeed ?? 42);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(
    experiment?.runs.map((r) => r.modelId).filter(Boolean) as string[] ?? [],
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [vlmModels, setVlmModels] = useState<VlmModel[]>([]);
  const [preview, setPreview] = useState<{ totalEligible: number; selected: PreviewExample[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load categories and models on mount
  useEffect(() => {
    Promise.all([
      listWorkbenchCategories(token),
      listLlmModels(token),
    ]).then(([cats, mods]) => {
      setCategories(cats);
      // Filter to vision-capable models only
      const vision = (mods as unknown as VlmModel[]).filter((m) => m.supportsVision);
      setVlmModels(vision);
    }).catch((err) => setError(err instanceof Error ? err.message : "Failed to load data"));
  }, [token]);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId],
    );
    setPreview(null);
  };

  const toggleModel = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId],
    );
  };

  const loadPreview = useCallback(async () => {
    if (selectedCategoryIds.length === 0 || exampleCount <= 0) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const result = await previewVlmExamples(token, selectedCategoryIds, exampleCount, exampleSeed);
      setPreview(result);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [token, selectedCategoryIds, exampleCount, exampleSeed]);

  const totalRuns = selectedModelIds.length;
  const hasModels = totalRuns >= 1;

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (selectedCategoryIds.length === 0) { setError("Select at least one category"); return; }
    if (!hasModels) { setError("Select at least one VLM model"); return; }

    setSubmitting(true);
    setError(null);
    try {
      if (isEdit) {
        await updateVlmExperiment(token, experiment.id, {
          name: name.trim(),
          categoryIds: selectedCategoryIds,
          exampleCount,
          exampleSeed,
          modelIds: selectedModelIds,
        });
      } else {
        await createVlmExperiment(token, {
          name: name.trim(),
          categoryIds: selectedCategoryIds,
          exampleCount,
          exampleSeed,
          modelIds: selectedModelIds,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEdit ? "Failed to update experiment" : "Failed to create experiment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open title={isEdit ? "Edit VLM Experiment" : "New VLM Experiment"} onClose={onClose}>
      {error && (
        <p className="mb-3 text-sm text-[hsl(var(--destructive))]">{error}</p>
      )}

      <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
        {/* Name */}
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opus vs Sonnet VLM eval" />
        </div>

        {/* Category multi-select */}
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

        {/* Example count + seed */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Example count</Label>
            <Input
              type="number"
              value={exampleCount}
              min={1}
              max={999}
              onChange={(e) => {
                setExampleCount(Number(e.target.value));
                setPreview(null);
              }}
            />
          </div>
          <div>
            <Label>Seed</Label>
            <Input
              type="number"
              value={exampleSeed}
              onChange={(e) => {
                setExampleSeed(Number(e.target.value));
                setPreview(null);
              }}
            />
          </div>
        </div>

        {/* VLM model multi-select */}
        <div>
          <Label>VLM Models (select 1+ ; vision-capable only)</Label>
          {vlmModels.length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              No vision-capable models found. Add models with vision support in the Models tab.
            </p>
          ) : (
            <div className="max-h-[200px] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-2">
              {vlmModels.map((m) => (
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
          )}
          {totalRuns > 1 && (
            <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
              {totalRuns} run{totalRuns !== 1 ? "s" : ""} &times; {exampleCount} examples = {totalRuns * exampleCount} evaluations
            </p>
          )}
        </div>

        {/* Preview button + results */}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadPreview}
            disabled={selectedCategoryIds.length === 0 || exampleCount <= 0 || previewLoading}
          >
            {previewLoading ? "Loading..." : "Preview Examples"}
          </Button>

          {preview && (
            <div className="mt-2">
              <Label>
                Selected examples ({preview.selected.length} of {preview.totalEligible} eligible)
              </Label>
              <div className="max-h-[180px] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] p-2 text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-[hsl(var(--muted-foreground))]">
                      <th className="pb-1 pr-2 font-medium">#</th>
                      <th className="pb-1 pr-2 font-medium">Prompt</th>
                      <th className="pb-1 pr-2 font-medium">Category</th>
                      <th className="pb-1 pr-2 font-medium text-right">Eval</th>
                      <th className="pb-1 pr-2 font-medium text-right">Visual</th>
                      <th className="pb-1 font-medium text-right">Assert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.selected.map((ex, idx) => (
                      <tr key={ex.id} className="border-t border-[hsl(var(--border)_/_0.3)]">
                        <td className="py-0.5 pr-2 text-[hsl(var(--muted-foreground))]">{idx + 1}</td>
                        <td className="max-w-[180px] truncate py-0.5 pr-2 text-[hsl(var(--foreground))]">
                          {ex.promptRef.prompt}
                        </td>
                        <td className="py-0.5 pr-2 text-[hsl(var(--muted-foreground))]">
                          {ex.promptRef.category.name}
                        </td>
                        <td className="py-0.5 pr-2 text-right text-[hsl(var(--foreground))]">
                          {ex.evalScore ?? "-"}
                        </td>
                        <td className="py-0.5 pr-2 text-right text-[hsl(var(--foreground))]">
                          {ex.visualScore ?? "-"}
                        </td>
                        <td className="py-0.5 text-right text-[hsl(var(--foreground))]">
                          {ex.assertionPassRate != null ? `${Math.round(Number(ex.assertionPassRate) * 100)}%` : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting || !hasModels}>
          {submitting ? (isEdit ? "Saving..." : "Creating...") : (isEdit ? "Save Changes" : "Create Experiment")}
        </Button>
      </div>
    </Dialog>
  );
}
