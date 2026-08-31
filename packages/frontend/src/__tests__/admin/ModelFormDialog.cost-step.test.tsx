// @vitest-environment jsdom
/**
 * Prices are stored as DECIMAL(12,4), so four-decimal rates are valid data —
 * e.g. a locally-hosted model amortised to 2.4329 USD / 1M output tokens.
 *
 * The cost inputs used `step={0.001}`, which makes the browser reject any value
 * that is not a multiple of 0.001 with a stepMismatch. That blocks submitting
 * the *whole* form — so editing an unrelated field like thinking effort became
 * impossible on any model with a four-decimal price, and the complaint surfaced
 * through the browser's own locale-formatted validation message rather than
 * anything this app controls.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmModelRow, LlmProviderRow } from "../../api/admin.api";
import { ModelFormDialog } from "../../components/admin/ModelFormDialog";

vi.mock("../../api/admin.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/admin.api")>()),
  fetchProviderModels: vi.fn().mockResolvedValue([]),
}));

const providers = [
  { name: "vllm-dgx-14", display_name: "vLLM DGX", is_active: true },
] as unknown as LlmProviderRow[];

/** A model priced the way the local Spark deployment actually is. */
const fourDecimalModel = {
  id: "m1",
  provider: "vllm-dgx-14",
  model_name: "qwen38-nvfp4-spark",
  display_name: "Qwen3.8 NVFP4 Spark",
  cost_per_1m_input: 0.0412,
  cost_per_1m_output: 2.4329,
  max_output_tokens: 32768,
  max_context_tokens: 262144,
  supports_thinking: true,
  default_thinking_effort: "high",
  supports_vision: true,
  supports_embeddings: false,
  streaming_enabled: true,
  vlm_eval_preamble: null,
} as unknown as LlmModelRow;

function renderDialog() {
  return render(
    <ModelFormDialog
      model={fourDecimalModel}
      providers={providers}
      token="t"
      saving={false}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("ModelFormDialog cost inputs", () => {
  afterEach(cleanup);

  it("accepts a four-decimal price without a step mismatch", () => {
    renderDialog();

    for (const id of ["model-cost-in", "model-cost-out"]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input).toBeTruthy();
      // The regression: a numeric step makes these values invalid, and an
      // invalid field blocks submission of every other field in the form.
      expect(input.validity.stepMismatch).toBe(false);
      expect(input.checkValidity()).toBe(true);
    }
  });

  it("shows the stored four-decimal values unrounded", () => {
    renderDialog();

    expect((document.getElementById("model-cost-in") as HTMLInputElement).value).toBe("0.0412");
    expect((document.getElementById("model-cost-out") as HTMLInputElement).value).toBe("2.4329");
  });

  it("leaves the thinking-effort field editable alongside them", () => {
    renderDialog();
    // The user-visible symptom was being unable to save a thinking-effort change.
    expect(screen.getByDisplayValue("High")).toBeTruthy();
  });
});
