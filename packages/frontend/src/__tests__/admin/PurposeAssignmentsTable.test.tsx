// @vitest-environment jsdom
/**
 * Per-purpose overrides used to be invisible (issue #26): the UI showed the
 * model's default thinking effort while the purpose ran on an override, so
 * purposes sharing one model looked identical while behaving differently.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmModelRow, LlmPurposeRow } from "../../api/admin.api";
import {
  PurposeAssignmentsTable,
  effectiveMaxOutput,
  effectiveThinkingEffort,
} from "../../components/admin/PurposeAssignmentsTable";

const updateLlmPurpose = vi.fn().mockResolvedValue({});
vi.mock("../../api/admin.api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/admin.api")>()),
  updateLlmPurpose: (...args: unknown[]) => updateLlmPurpose(...args),
}));

const model = {
  id: "m1", provider: "vllm", model_name: "spark", display_name: "Spark",
  default_thinking_effort: "medium", supports_thinking: true, is_active: true,
  max_output_tokens: 32768,
} as unknown as LlmModelRow;

/** Three purposes on one model, running at three different efforts. */
const purposes = [
  { purpose: "spec_generation", modelId: "m1", overrideThinkingEffort: "off", overrideMaxOutputTokens: null },
  { purpose: "spec_enrichment", modelId: "m1", overrideThinkingEffort: "low", overrideMaxOutputTokens: 8192 },
  { purpose: "workbench_codegen", modelId: "m1", overrideThinkingEffort: null, overrideMaxOutputTokens: null },
] as unknown as LlmPurposeRow[];

function renderTable() {
  return render(
    <PurposeAssignmentsTable
      purposes={purposes} models={[model]} token="t"
      onSaved={vi.fn()} onError={vi.fn()}
    />,
  );
}

describe("effectiveThinkingEffort", () => {
  it("prefers the override and reports it as such", () => {
    expect(effectiveThinkingEffort({ overrideThinkingEffort: "low" }, model))
      .toEqual({ effort: "low", source: "override" });
  });

  it("falls back to the model default when no override is set", () => {
    expect(effectiveThinkingEffort({ overrideThinkingEffort: null }, model))
      .toEqual({ effort: "medium", source: "default" });
  });

  it("reports no effort when neither is available", () => {
    expect(effectiveThinkingEffort({ overrideThinkingEffort: null }, undefined))
      .toEqual({ effort: null, source: "default" });
  });
});

describe("effectiveMaxOutput", () => {
  it("prefers the override and reports it as such", () => {
    expect(effectiveMaxOutput({ overrideMaxOutputTokens: 8192 }, model))
      .toEqual({ tokens: 8192, source: "override" });
  });

  it("falls back to the model's cap when no override is set", () => {
    expect(effectiveMaxOutput({ overrideMaxOutputTokens: null }, model))
      .toEqual({ tokens: 32768, source: "default" });
  });
});

describe("PurposeAssignmentsTable", () => {
  afterEach(() => { cleanup(); updateLlmPurpose.mockClear(); });

  it("shows the effort each purpose will actually run at, not the model default", () => {
    renderTable();

    expect(screen.getByTestId("effective-effort-spec_generation").textContent).toContain("off");
    expect(screen.getByTestId("effective-effort-spec_enrichment").textContent).toContain("low");
    expect(screen.getByTestId("effective-effort-workbench_codegen").textContent).toContain("medium");
  });

  it("distinguishes an overridden purpose from one on the model default", () => {
    renderTable();

    // The bug was that these three looked identical.
    expect(screen.getByTestId("effective-effort-spec_generation").dataset.source).toBe("override");
    expect(screen.getByTestId("effective-effort-spec_enrichment").dataset.source).toBe("override");
    expect(screen.getByTestId("effective-effort-workbench_codegen").dataset.source).toBe("default");
  });

  it("shows the max-output override, and blank when none is set", () => {
    renderTable();

    expect((screen.getByLabelText("Max output tokens for spec_enrichment") as HTMLInputElement).value).toBe("8192");
    expect((screen.getByLabelText("Max output tokens for workbench_codegen") as HTMLInputElement).value).toBe("");
  });

  it("shows which output cap each purpose runs under, and its source", () => {
    renderTable();

    const overridden = screen.getByTestId("effective-max-output-spec_enrichment");
    expect(overridden.dataset.source).toBe("override");
    expect(overridden.textContent).toContain("8192");

    const inherited = screen.getByTestId("effective-max-output-workbench_codegen");
    expect(inherited.dataset.source).toBe("default");
    expect(inherited.textContent).toContain("32768");
  });

  it("clears a max-output override back to the model cap", async () => {
    renderTable();

    fireEvent.change(screen.getByLabelText("Max output tokens for spec_enrichment"), { target: { value: "" } });

    const cell = screen.getByTestId("effective-max-output-spec_enrichment");
    expect(cell.dataset.source).toBe("default");
    expect(cell.textContent).toContain("32768");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(updateLlmPurpose).toHaveBeenCalledTimes(1));
    expect(updateLlmPurpose.mock.calls[0][2]).toEqual({ overrideMaxOutputTokens: null });
  });

  it("hides Save again when an edit is reverted by hand", () => {
    renderTable();

    const select = screen.getByLabelText("Thinking effort for spec_enrichment");
    fireEvent.change(select, { target: { value: "high" } });
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeNull();

    fireEvent.change(select, { target: { value: "low" } });  // back to the stored value
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("saves an effort change without resending the model id", async () => {
    renderTable();

    fireEvent.change(screen.getByLabelText("Thinking effort for workbench_codegen"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateLlmPurpose).toHaveBeenCalledTimes(1));
    const [, purpose, patch] = updateLlmPurpose.mock.calls[0];
    expect(purpose).toBe("workbench_codegen");
    expect(patch).toEqual({ overrideThinkingEffort: "high" });
    expect(patch).not.toHaveProperty("modelId");
  });

  it("clears an override back to the model default", async () => {
    renderTable();

    fireEvent.change(screen.getByLabelText("Thinking effort for spec_enrichment"), { target: { value: "__default__" } });

    // The row immediately reflects the fallback, before any round-trip.
    const cell = screen.getByTestId("effective-effort-spec_enrichment");
    expect(cell.dataset.source).toBe("default");
    expect(cell.textContent).toContain("medium");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(updateLlmPurpose).toHaveBeenCalledTimes(1));
    expect(updateLlmPurpose.mock.calls[0][2]).toEqual({ overrideThinkingEffort: null });
  });
});
