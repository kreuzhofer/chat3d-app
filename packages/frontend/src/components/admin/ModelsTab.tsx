import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Save } from "lucide-react";
import {
  listAdminLlmModels,
  listLlmPurposes,
  listLlmProviders,
  createLlmModel,
  updateLlmModel,
  deleteLlmModel,
  updateLlmPurpose,
  type LlmModelRow,
  type LlmPurposeRow,
  type LlmProviderRow,
  type CreateLlmModelInput,
} from "../../api/admin.api";
import { SectionCard } from "../layout/SectionCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ModelFormDialog, type ModelFormData } from "./ModelFormDialog";

const PROVIDER_COLORS: Record<string, string> = {
  openai: "bg-blue-900 text-blue-200",
  anthropic: "bg-orange-900 text-orange-200",
  xai: "bg-purple-900 text-purple-200",
  deepseek: "bg-cyan-900 text-cyan-200",
  minimax: "bg-rose-900 text-rose-200",
  ollama: "bg-green-900 text-green-200",
};

export function providerBadge(provider: string) {
  const cls = PROVIDER_COLORS[provider] ?? "bg-gray-900 text-gray-200";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{provider}</span>;
}

function formatCost(value: number): string {
  return `$${Number(value).toFixed(2)}`;
}

function formatTokens(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(value);
}

const PURPOSE_LABELS: Record<string, string> = {
  conversation: "Conversation",
  agent_codegen: "Code Generation (Chat)",
  workbench_codegen: "Code Generation (Workbench)",
  vlm_eval: "VLM Evaluation",
  embedding: "Embedding",
  prompt_distill: "Prompt Distillation",
  tag_suggest: "Tag Suggestion",
  spec_generation: "Spec Generation",
  code_review: "Code Review",
};

/** One-liner explaining fallback when a purpose is unassigned. */
const PURPOSE_FALLBACKS: Record<string, string> = {
  workbench_codegen: "Falls back to: agent_codegen",
  spec_generation: "Falls back to: conversation",
  code_review: "Falls back to: spec_generation → conversation",
};

export interface ModelsTabProps {
  token: string;
}

export function ModelsTab({ token }: ModelsTabProps) {
  const [models, setModels] = useState<LlmModelRow[]>([]);
  const [providers, setProviders] = useState<LlmProviderRow[]>([]);
  const [purposes, setPurposes] = useState<LlmPurposeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Model form dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<LlmModelRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Purpose edit state (inline)
  const [purposeEdits, setPurposeEdits] = useState<Record<string, string>>({});
  const [savingPurpose, setSavingPurpose] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [m, p, prov] = await Promise.all([
        listAdminLlmModels(token),
        listLlmPurposes(token),
        listLlmProviders(token),
      ]);
      setModels(m);
      setPurposes(p);
      setProviders(prov);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model configuration");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateModel = () => {
    setEditingModel(null);
    setDialogOpen(true);
  };

  const handleEditModel = (model: LlmModelRow) => {
    setEditingModel(model);
    setDialogOpen(true);
  };

  const handleDeleteModel = async (model: LlmModelRow) => {
    if (!confirm(`Delete model ${model.provider}/${model.model_name}? This cannot be undone.`)) return;
    try {
      await deleteLlmModel(token, model.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    }
  };

  const handleToggleActive = async (model: LlmModelRow) => {
    try {
      await updateLlmModel(token, model.id, { isActive: !model.is_active });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle model status");
    }
  };

  const handleSaveModel = async (data: ModelFormData) => {
    setSaving(true);
    try {
      if (editingModel) {
        const patch: Record<string, unknown> = {
          provider: data.provider,
          modelName: data.modelName,
          displayName: data.displayName || null,
          costPer1mInput: data.costPer1mInput,
          costPer1mOutput: data.costPer1mOutput,
          maxOutputTokens: data.maxOutputTokens || null,
          maxContextTokens: data.maxContextTokens || null,
          supportsThinking: data.supportsThinking,
          defaultThinkingEffort: data.supportsThinking ? data.defaultThinkingEffort : null,
          supportsVision: data.supportsVision,
          supportsEmbeddings: data.supportsEmbeddings,
        };
        await updateLlmModel(token, editingModel.id, patch);
      } else {
        const input: CreateLlmModelInput = {
          provider: data.provider,
          modelName: data.modelName,
          displayName: data.displayName || undefined,
          costPer1mInput: data.costPer1mInput,
          costPer1mOutput: data.costPer1mOutput,
          maxOutputTokens: data.maxOutputTokens || null,
          maxContextTokens: data.maxContextTokens || null,
          supportsThinking: data.supportsThinking,
          defaultThinkingEffort: data.supportsThinking ? data.defaultThinkingEffort : null,
          supportsVision: data.supportsVision,
          supportsEmbeddings: data.supportsEmbeddings,
        };
        await createLlmModel(token, input);
      }
      setDialogOpen(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save model");
    } finally {
      setSaving(false);
    }
  };

  const handlePurposeModelChange = (purpose: string, modelId: string) => {
    setPurposeEdits((prev) => ({ ...prev, [purpose]: modelId }));
  };

  const handleSavePurpose = async (purpose: string) => {
    const newModelId = purposeEdits[purpose];
    if (!newModelId) return;
    setSavingPurpose(purpose);
    try {
      await updateLlmPurpose(token, purpose, { modelId: newModelId });
      setPurposeEdits((prev) => {
        const next = { ...prev };
        delete next[purpose];
        return next;
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update purpose assignment");
    } finally {
      setSavingPurpose(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-[hsl(var(--muted-foreground))]">
        Loading model configuration...
      </div>
    );
  }

  const activeModels = models.filter((m) => m.is_active);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-200">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Models Table */}
      <SectionCard
        title="LLM Models"
        description="Configured language models with pricing, capabilities, and provider assignments."
        actions={
          <Button size="sm" onClick={handleCreateModel}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Model
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-left text-xs text-[hsl(var(--muted-foreground))]">
                <th className="pb-2 pr-3 font-medium">Provider</th>
                <th className="pb-2 pr-3 font-medium">Model</th>
                <th className="pb-2 pr-3 font-medium">Cost (in/out)</th>
                <th className="pb-2 pr-3 font-medium">Max Output</th>
                <th className="pb-2 pr-3 font-medium">Context</th>
                <th className="pb-2 pr-3 font-medium">Thinking</th>
                <th className="pb-2 pr-3 font-medium">Vision</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} className="border-b border-[hsl(var(--border)_/_0.5)] last:border-0">
                  <td className="py-2 pr-3">{providerBadge(model.provider)}</td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{model.model_name}</div>
                    {model.display_name && (
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">{model.display_name}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs tabular-nums">
                    {formatCost(model.cost_per_1m_input)} / {formatCost(model.cost_per_1m_output)}
                  </td>
                  <td className="py-2 pr-3 text-xs tabular-nums">{formatTokens(model.max_output_tokens)}</td>
                  <td className="py-2 pr-3 text-xs tabular-nums">{formatTokens(model.max_context_tokens)}</td>
                  <td className="py-2 pr-3 text-xs">
                    {model.supports_thinking ? (
                      <span>
                        <span className="text-green-600">&#10003;</span>
                        {model.default_thinking_effort && (
                          <span className="ml-1 text-[hsl(var(--muted-foreground))]">{model.default_thinking_effort}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">&#10007;</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {model.supports_vision ? (
                      <span className="text-green-600">&#10003;</span>
                    ) : (
                      <span className="text-[hsl(var(--muted-foreground))]">&#10007;</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={model.is_active ? "success" : "neutral"}
                      className="cursor-pointer"
                      onClick={() => handleToggleActive(model)}
                    >
                      {model.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button
                        className="rounded p-1 hover:bg-[hsl(var(--muted))]"
                        title="Edit"
                        onClick={() => handleEditModel(model)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="rounded p-1 hover:bg-[hsl(var(--muted))] text-red-500"
                        title="Delete"
                        onClick={() => handleDeleteModel(model)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-[hsl(var(--muted-foreground))]">
                    No models configured. Click "Add Model" to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Purpose Assignments */}
      <SectionCard
        title="Purpose Assignments"
        description="Map each pipeline purpose to a specific model. Changes take effect on the next request."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-left text-xs text-[hsl(var(--muted-foreground))]">
                <th className="pb-2 pr-3 font-medium">Purpose</th>
                <th className="pb-2 pr-3 font-medium">Assigned Model</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {purposes.map((p) => {
                const currentModelId = purposeEdits[p.purpose] ?? p.modelId ?? "";
                const hasChange = purposeEdits[p.purpose] !== undefined && purposeEdits[p.purpose] !== (p.modelId ?? "");
                return (
                  <tr key={p.purpose} className="border-b border-[hsl(var(--border)_/_0.5)] last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{PURPOSE_LABELS[p.purpose] ?? p.purpose}</div>
                      {PURPOSE_FALLBACKS[p.purpose] && !p.modelId && (
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">{PURPOSE_FALLBACKS[p.purpose]}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                        value={currentModelId}
                        onChange={(e) => handlePurposeModelChange(p.purpose, e.target.value)}
                      >
                        <option value="">— Not assigned —</option>
                        {activeModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.provider}/{m.model_name}
                            {m.display_name ? ` (${m.display_name})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      {hasChange && (
                        <Button
                          size="sm"
                          onClick={() => handleSavePurpose(p.purpose)}
                          disabled={savingPurpose === p.purpose}
                        >
                          <Save className="mr-1 h-3 w-3" />
                          {savingPurpose === p.purpose ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Model Form Dialog */}
      {dialogOpen && (
        <ModelFormDialog
          model={editingModel}
          providers={providers}
          saving={saving}
          onSave={handleSaveModel}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}
