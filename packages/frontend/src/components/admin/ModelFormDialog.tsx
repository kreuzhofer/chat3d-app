import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchProviderModels, type LlmModelRow, type LlmProviderRow } from "../../api/admin.api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FormField } from "../ui/form";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";

export interface ModelFormData {
  provider: string;
  modelName: string;
  displayName: string;
  costPer1mInput: number;
  costPer1mOutput: number;
  maxOutputTokens: number | null;
  maxContextTokens: number | null;
  supportsThinking: boolean;
  defaultThinkingEffort: string | null;
  supportsVision: boolean;
  supportsEmbeddings: boolean;
  streamingEnabled: boolean;
  vlmEvalPreamble: string;
}

const THINKING_EFFORT_OPTIONS = [
  { value: "", label: "\u2014 None \u2014" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function emptyForm(defaultProvider: string): ModelFormData {
  return {
    provider: defaultProvider,
    modelName: "",
    displayName: "",
    costPer1mInput: 0,
    costPer1mOutput: 0,
    maxOutputTokens: null,
    maxContextTokens: null,
    supportsThinking: false,
    defaultThinkingEffort: null,
    supportsVision: false,
    supportsEmbeddings: false,
    streamingEnabled: true,
    vlmEvalPreamble: "",
  };
}

function modelToForm(model: LlmModelRow): ModelFormData {
  return {
    provider: model.provider,
    modelName: model.model_name,
    displayName: model.display_name ?? "",
    costPer1mInput: model.cost_per_1m_input,
    costPer1mOutput: model.cost_per_1m_output,
    maxOutputTokens: model.max_output_tokens,
    maxContextTokens: model.max_context_tokens,
    supportsThinking: model.supports_thinking,
    defaultThinkingEffort: model.default_thinking_effort,
    supportsVision: model.supports_vision,
    supportsEmbeddings: model.supports_embeddings,
    streamingEnabled: model.streaming_enabled,
    vlmEvalPreamble: model.vlm_eval_preamble ?? "",
  };
}

export interface ModelFormDialogProps {
  model: LlmModelRow | null;
  providers: LlmProviderRow[];
  token: string;
  saving: boolean;
  onSave: (data: ModelFormData) => void;
  onClose: () => void;
}

export function ModelFormDialog({ model, providers, token, saving, onSave, onClose }: ModelFormDialogProps) {
  const defaultProvider = providers.length > 0 ? providers[0].name : "openai";
  const [form, setForm] = useState<ModelFormData>(() => (model ? modelToForm(model) : emptyForm(defaultProvider)));
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  // Reset form when model prop changes
  useEffect(() => {
    setForm(model ? modelToForm(model) : emptyForm(defaultProvider));
  }, [model, defaultProvider]);

  // Auto-fetch available models when provider changes
  useEffect(() => {
    if (!form.provider) {
      setAvailableModels([]);
      return;
    }

    let cancelled = false;
    setFetchingModels(true);
    fetchProviderModels(token, form.provider)
      .then((models) => {
        if (!cancelled) setAvailableModels(models);
      })
      .catch(() => {
        if (!cancelled) setAvailableModels([]);
      })
      .finally(() => {
        if (!cancelled) setFetchingModels(false);
      });

    return () => { cancelled = true; };
  }, [form.provider, token]);

  const isEdit = model !== null;
  const canSubmit = form.provider.trim() !== "" && form.modelName.trim() !== "";

  const providerOptions = providers.map((p) => ({
    value: p.name,
    label: p.display_name ?? p.name,
  }));

  function patch(partial: Partial<ModelFormData>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || saving) return;
    onSave(form);
  }

  return (
    <Dialog
      open
      title={isEdit ? "Edit Model" : "Add Model"}
      description={isEdit ? `Editing ${model.provider}/${model.model_name}` : "Configure a new LLM model."}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Provider + Model Name row */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Provider" htmlFor="model-provider" required>
            <Select
              id="model-provider"
              options={providerOptions}
              value={form.provider}
              onChange={(e) => patch({ provider: e.target.value })}
            />
          </FormField>

          <FormField label="Model Name" htmlFor="model-name" required helperText="API model identifier">
            <div className="relative">
              <Input
                id="model-name"
                list="model-name-suggestions"
                value={form.modelName}
                placeholder="e.g. gpt-4o-mini"
                onChange={(e) => patch({ modelName: e.target.value })}
              />
              {fetchingModels && (
                <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[hsl(var(--muted-foreground))]" />
              )}
              <datalist id="model-name-suggestions">
                {availableModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </FormField>
        </div>

        <FormField label="Display Name" htmlFor="model-display-name" helperText="Friendly label for the UI (optional)">
          <Input
            id="model-display-name"
            value={form.displayName}
            placeholder="e.g. GPT-4o Mini"
            onChange={(e) => patch({ displayName: e.target.value })}
          />
        </FormField>

        {/* Cost row */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Cost per 1M Input Tokens" htmlFor="model-cost-in" helperText="USD">
            <Input
              id="model-cost-in"
              type="number"
              min={0}
              step={0.001}
              value={form.costPer1mInput}
              onChange={(e) => patch({ costPer1mInput: parseFloat(e.target.value) || 0 })}
            />
          </FormField>

          <FormField label="Cost per 1M Output Tokens" htmlFor="model-cost-out" helperText="USD">
            <Input
              id="model-cost-out"
              type="number"
              min={0}
              step={0.001}
              value={form.costPer1mOutput}
              onChange={(e) => patch({ costPer1mOutput: parseFloat(e.target.value) || 0 })}
            />
          </FormField>
        </div>

        {/* Token limits row */}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Max Output Tokens" htmlFor="model-max-output" helperText="Leave empty for provider default">
            <Input
              id="model-max-output"
              type="number"
              min={0}
              value={form.maxOutputTokens ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                patch({ maxOutputTokens: v === "" ? null : parseInt(v, 10) || null });
              }}
            />
          </FormField>

          <FormField label="Max Context Tokens" htmlFor="model-max-context" helperText="Important for Ollama models">
            <Input
              id="model-max-context"
              type="number"
              min={0}
              value={form.maxContextTokens ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                patch({ maxContextTokens: v === "" ? null : parseInt(v, 10) || null });
              }}
            />
          </FormField>
        </div>

        {/* Capability switches */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-[hsl(var(--border))] p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.supportsThinking}
                onCheckedChange={(checked) =>
                  patch({ supportsThinking: checked, defaultThinkingEffort: checked ? "medium" : null })
                }
              />
              Thinking
            </label>
          </div>

          <div className="rounded-md border border-[hsl(var(--border))] p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.supportsVision}
                onCheckedChange={(checked) => patch({ supportsVision: checked })}
              />
              Vision
            </label>
          </div>

          <div className="rounded-md border border-[hsl(var(--border))] p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.supportsEmbeddings}
                onCheckedChange={(checked) => patch({ supportsEmbeddings: checked })}
              />
              Embeddings
            </label>
          </div>

          <div className="rounded-md border border-[hsl(var(--border))] p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.streamingEnabled}
                onCheckedChange={(checked) => patch({ streamingEnabled: checked })}
              />
              Streaming
            </label>
          </div>
        </div>

        {/* Thinking effort (shown only when thinking is enabled) */}
        {form.supportsThinking ? (
          <FormField label="Default Thinking Effort" htmlFor="model-thinking-effort">
            <Select
              id="model-thinking-effort"
              options={THINKING_EFFORT_OPTIONS}
              value={form.defaultThinkingEffort ?? ""}
              onChange={(e) => patch({ defaultThinkingEffort: e.target.value || null })}
            />
          </FormField>
        ) : null}

        {/* VLM Eval Preamble (shown only when vision is supported) */}
        {form.supportsVision && (
          <FormField label="VLM Eval Preamble" htmlFor="model-vlm-preamble">
            <textarea
              id="model-vlm-preamble"
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
              rows={4}
              placeholder="Optional scoring calibration preamble prepended to the VLM evaluation prompt..."
              value={form.vlmEvalPreamble}
              onChange={(e) => patch({ vlmEvalPreamble: e.target.value })}
            />
          </FormField>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!canSubmit || saving}>
            {isEdit ? "Update Model" : "Create Model"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
