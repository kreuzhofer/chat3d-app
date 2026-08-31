import { useState } from "react";
import { Save } from "lucide-react";
import { THINKING_EFFORT_VALUES } from "./thinking-effort";
import { updateLlmPurpose, type LlmModelRow, type LlmPurposeRow } from "../../api/admin.api";
import { toErrorMessage } from "./utils";
import { SectionCard } from "../layout/SectionCard";
import { Button } from "../ui/button";

const PURPOSE_LABELS: Record<string, string> = {
  conversation: "Conversation",
  agent_codegen: "Code Generation (Chat)",
  workbench_codegen: "Code Generation (Workbench)",
  vlm_eval: "VLM Evaluation",
  embedding: "Embedding",
  prompt_distill: "Prompt Distillation",
  tag_suggest: "Tag Suggestion",
  spec_generation: "Spec Generation",
  spec_enrichment: "Spec Enrichment",
  code_review: "Code Review",
  decomposition_decision: "Decomposition Decision (Routing)",
};

const PURPOSE_FALLBACKS: Record<string, string> = {
  workbench_codegen: "Falls back to: agent_codegen",
  spec_generation: "Falls back to: conversation",
  spec_enrichment: "Falls back to: spec_generation → conversation",
  code_review: "Falls back to: spec_generation → conversation",
  decomposition_decision: "Unassigned → router falls back to single-agent",
};

/** Sentinel for "no override" in the select, since an <option> value cannot be null. */
const USE_DEFAULT = "__default__";

interface PurposeDraft {
  modelId?: string;
  overrideThinkingEffort?: string | null;
  overrideMaxOutputTokens?: number | null;
}

/**
 * The effort a purpose will actually run at, and where that value came from.
 *
 * Mirrors the backend rule `purposeOverride ?? modelDefault`. Showing the model
 * default alone is what made overrides invisible: four purposes sharing one
 * model ran at three different efforts while the UI displayed one value for
 * all of them (issue #26).
 */
export function effectiveThinkingEffort(
  purpose: Pick<LlmPurposeRow, "overrideThinkingEffort">,
  model: LlmModelRow | undefined,
): { effort: string | null; source: "override" | "default" } {
  if (purpose.overrideThinkingEffort != null) {
    return { effort: purpose.overrideThinkingEffort, source: "override" };
  }
  return { effort: model?.default_thinking_effort ?? null, source: "default" };
}

/**
 * The output cap a purpose will actually run under, and where it came from.
 * The brief asks for the same override-vs-default clarity the effort has.
 */
export function effectiveMaxOutput(
  purpose: Pick<LlmPurposeRow, "overrideMaxOutputTokens">,
  model: LlmModelRow | undefined,
): { tokens: number | null; source: "override" | "default" } {
  if (purpose.overrideMaxOutputTokens != null) {
    return { tokens: purpose.overrideMaxOutputTokens, source: "override" };
  }
  return { tokens: model?.max_output_tokens ?? null, source: "default" };
}

export interface PurposeAssignmentsTableProps {
  purposes: LlmPurposeRow[];
  models: LlmModelRow[];
  token: string;
  onSaved: () => void;
  onError: (message: string) => void;
}

export function PurposeAssignmentsTable({ purposes, models, token, onSaved, onError }: PurposeAssignmentsTableProps) {
  const [drafts, setDrafts] = useState<Record<string, PurposeDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const activeModels = models.filter((m) => m.is_active);

  const patchDraft = (purpose: string, patch: PurposeDraft) =>
    setDrafts((prev) => ({ ...prev, [purpose]: { ...prev[purpose], ...patch } }));

  const handleSave = async (row: LlmPurposeRow) => {
    const draft = drafts[row.purpose];
    if (!draft) return;
    setSaving(row.purpose);
    try {
      // Send only what changed — the endpoint accepts a partial patch, so an
      // effort edit must not have to resend the model id.
      await updateLlmPurpose(token, row.purpose, draft);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.purpose];
        return next;
      });
      onSaved();
    } catch (err) {
      onError(toErrorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <SectionCard
      title="Purpose Assignments"
      description="Map each pipeline purpose to a model, and optionally override its thinking effort and output cap. Changes take effect on the next request."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-xs text-[hsl(var(--muted-foreground))]">
              <th className="pb-2 pr-3 font-medium">Purpose</th>
              <th className="pb-2 pr-3 font-medium">Assigned Model</th>
              <th className="pb-2 pr-3 font-medium">Thinking Effort</th>
              <th className="pb-2 pr-3 font-medium">Max Output</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {purposes.map((p) => {
              const draft = drafts[p.purpose] ?? {};
              const modelId = draft.modelId ?? p.modelId ?? "";
              const model = models.find((m) => m.id === modelId);
              const overrideEffort = draft.overrideThinkingEffort !== undefined
                ? draft.overrideThinkingEffort
                : p.overrideThinkingEffort;
              const { effort, source } = effectiveThinkingEffort({ overrideThinkingEffort: overrideEffort }, model);
              const maxOut = draft.overrideMaxOutputTokens !== undefined
                ? draft.overrideMaxOutputTokens
                : p.overrideMaxOutputTokens;
              const maxOutInfo = effectiveMaxOutput({ overrideMaxOutputTokens: maxOut }, model);
              // Compare against the stored row: reverting a field by hand must
              // hide Save again, not leave a no-op edit pending.
              const dirty =
                (draft.modelId !== undefined && draft.modelId !== (p.modelId ?? "")) ||
                (draft.overrideThinkingEffort !== undefined && draft.overrideThinkingEffort !== p.overrideThinkingEffort) ||
                (draft.overrideMaxOutputTokens !== undefined && draft.overrideMaxOutputTokens !== p.overrideMaxOutputTokens);

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
                      aria-label={`Model for ${p.purpose}`}
                      className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                      value={modelId}
                      onChange={(e) => patchDraft(p.purpose, { modelId: e.target.value })}
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

                  <td className="py-2 pr-3">
                    <select
                      aria-label={`Thinking effort for ${p.purpose}`}
                      className="rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                      value={overrideEffort ?? USE_DEFAULT}
                      onChange={(e) =>
                        patchDraft(p.purpose, {
                          overrideThinkingEffort: e.target.value === USE_DEFAULT ? null : e.target.value,
                        })
                      }
                    >
                      <option value={USE_DEFAULT}>
                        Model default{model?.default_thinking_effort ? ` (${model.default_thinking_effort})` : ""}
                      </option>
                      {THINKING_EFFORT_VALUES.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                    <div
                      className="mt-1 text-xs"
                      data-testid={`effective-effort-${p.purpose}`}
                      data-source={source}
                    >
                      {source === "override" ? (
                        <span className="text-amber-500">override → {effort}</span>
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">
                          {effort ? `default → ${effort}` : "—"}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-2 pr-3">
                    <input
                      aria-label={`Max output tokens for ${p.purpose}`}
                      type="number"
                      min={1}
                      step={1}
                      placeholder="default"
                      className="w-24 rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-sm"
                      value={maxOut ?? ""}
                      onChange={(e) =>
                        patchDraft(p.purpose, {
                          overrideMaxOutputTokens:
                            e.target.value === "" ? null : Math.trunc(Number(e.target.value)),
                        })
                      }
                    />
                    <div
                      className="mt-1 text-xs"
                      data-testid={`effective-max-output-${p.purpose}`}
                      data-source={maxOutInfo.source}
                    >
                      {maxOutInfo.source === "override" ? (
                        <span className="text-amber-500">override → {maxOutInfo.tokens}</span>
                      ) : (
                        <span className="text-[hsl(var(--muted-foreground))]">
                          {maxOutInfo.tokens ? `default → ${maxOutInfo.tokens}` : "—"}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-2">
                    {dirty && (
                      <Button size="sm" onClick={() => handleSave(p)} disabled={saving === p.purpose}>
                        <Save className="mr-1 h-3 w-3" />
                        {saving === p.purpose ? "Saving..." : "Save"}
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
  );
}
