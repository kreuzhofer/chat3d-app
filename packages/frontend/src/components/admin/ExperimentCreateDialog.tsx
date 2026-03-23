import { useCallback, useEffect, useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import {
  createExperiment,
  listWorkbenchCategories,
  listLlmModels,
  previewPrompts,
} from "../../api/experiment.api";

interface Props {
  token: string;
  onClose: () => void;
  onCreated: () => void;
}

export function ExperimentCreateDialog({ token, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [promptCount, setPromptCount] = useState(10);
  const [promptSeed, setPromptSeed] = useState(42);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; promptCount: number }>>([]);
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
    if (!categoryId || promptCount <= 0) {
      setPreviewedPrompts([]);
      return;
    }
    try {
      const result = await previewPrompts(token, categoryId, promptCount, promptSeed);
      setPreviewedPrompts(result);
    } catch {
      setPreviewedPrompts([]);
    }
  }, [token, categoryId, promptCount, promptSeed]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const maxPrompts = selectedCategory?.promptCount ?? 0;

  const toggleModel = (modelId: string) => {
    setSelectedModelIds((prev) =>
      prev.includes(modelId) ? prev.filter((id) => id !== modelId) : [...prev, modelId],
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (!categoryId) { setError("Select a category"); return; }
    if (selectedModelIds.length < 2) { setError("Select at least 2 models to compare"); return; }

    setSubmitting(true);
    setError(null);
    try {
      await createExperiment(token, {
        name: name.trim(),
        categoryId,
        promptCount,
        promptSeed,
        modelIds: selectedModelIds,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create experiment");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open title="New Experiment" onClose={onClose}>
      {error && (
        <p className="mb-3 text-sm text-[hsl(var(--destructive))]">{error}</p>
      )}

      <div className="grid gap-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opus vs Sonnet codegen" />
        </div>

        <div>
          <Label>Category</Label>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder="Select category"
            options={categories.map((c) => ({ value: c.id, label: `${c.name} (${c.promptCount} prompts)` }))}
          />
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
          <Label>Models to compare (select 2+)</Label>
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

        {previewedPrompts.length > 0 && (
          <div>
            <Label>Selected prompts preview ({previewedPrompts.length})</Label>
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
        <Button onClick={handleSubmit} disabled={submitting || selectedModelIds.length < 2}>
          {submitting ? "Creating..." : "Create Experiment"}
        </Button>
      </div>
    </Dialog>
  );
}
