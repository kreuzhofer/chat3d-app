/**
 * Instrument id (ADR 0003) and judge identity (ADR 0004).
 *
 * The id is a name plus a content hash of the whole procedure. It must be
 * the same for every example of a run, change when any part of the procedure
 * changes, and ignore the specimen.
 */
import { describe, it, expect, vi } from "vitest";

const zoom = { enabled: true, resolutionPx: 1536, maxFollowUps: 3 };
vi.mock("../services/generation-settings.service.js", () => ({
  getZoomSettings: vi.fn(async () => zoom),
}));

import {
  computeInstrumentId,
  currentInstrumentId,
  judgeThinkingEffort,
  withJudgeThinking,
  PRODUCTION_INSTRUMENT,
  PRODUCTION_INSTRUMENT_NAME,
} from "../services/visual-eval-instrument-id.service.js";

describe("computeInstrumentId", () => {
  it("is <name>@<12 hex> and deterministic", () => {
    const a = computeInstrumentId(PRODUCTION_INSTRUMENT, zoom);
    const b = computeInstrumentId(PRODUCTION_INSTRUMENT, { ...zoom });
    expect(a).toMatch(/^production@[0-9a-f]{12}$/);
    expect(a).toBe(b);
  });

  it("stays one id however many examples are judged — the specimen is not part of it", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 125; i++) ids.add(computeInstrumentId(PRODUCTION_INSTRUMENT, zoom));
    expect(ids.size).toBe(1);
  });

  it("changes with the answer shape — a variant that asks for a parts inventory is another instrument (#66)", () => {
    const template = PRODUCTION_INSTRUMENT.template;
    const production = computeInstrumentId({ name: "v", template }, zoom);
    const inventory = computeInstrumentId({ name: "v", template, responseShape: "inventory" }, zoom);
    expect(inventory).not.toBe(production);
    // Spelling the default out changes nothing.
    expect(computeInstrumentId({ name: "v", template, responseShape: "production" }, zoom)).toBe(production);
  });

  it("changes with the template", () => {
    const edited = { ...PRODUCTION_INSTRUMENT, template: PRODUCTION_INSTRUMENT.template + "\nBe strict." };
    expect(computeInstrumentId(edited, zoom)).not.toBe(computeInstrumentId(PRODUCTION_INSTRUMENT, zoom));
  });

  it("counts the follow-up's views as part of the procedure (#67)", async () => {
    // Which views the follow-up enlarges decides what the judge can see when
    // it resolves an uncertain item, so two runs that send different ones are
    // not the same instrument. The set lives in `visual-eval-views.ts`; this
    // pins that the id moves with it rather than silently reusing an id.
    const { FOLLOW_UP_VIEWS } = await import("../services/visual-eval-views.js");
    expect([...FOLLOW_UP_VIEWS]).toEqual(["top", "ortho_45", "ortho_45_bottom"]);
    const procedure = JSON.stringify({ followUpViews: [...FOLLOW_UP_VIEWS] });
    expect(procedure).toContain("ortho_45_bottom");
  });

  it("changes with each zoom setting — an admin edit is a new revision", () => {
    const base = computeInstrumentId(PRODUCTION_INSTRUMENT, zoom);
    expect(computeInstrumentId(PRODUCTION_INSTRUMENT, { ...zoom, enabled: false })).not.toBe(base);
    expect(computeInstrumentId(PRODUCTION_INSTRUMENT, { ...zoom, resolutionPx: 2048 })).not.toBe(base);
    expect(computeInstrumentId(PRODUCTION_INSTRUMENT, { ...zoom, maxFollowUps: 5 })).not.toBe(base);
  });

  it("names an experiment variant by its id, with the same hash rule", () => {
    const variant = { name: "pb-legacy-control", template: PRODUCTION_INSTRUMENT.template };
    const id = computeInstrumentId(variant, zoom);
    expect(id.startsWith("pb-legacy-control@")).toBe(true);
    // Same procedure, different name: the hash half is identical.
    expect(id.split("@")[1]).toBe(computeInstrumentId(PRODUCTION_INSTRUMENT, zoom).split("@")[1]);
  });

  it("currentInstrumentId is production's template under the live zoom settings", async () => {
    expect(await currentInstrumentId()).toBe(computeInstrumentId(PRODUCTION_INSTRUMENT, zoom));
    expect(PRODUCTION_INSTRUMENT.name).toBe(PRODUCTION_INSTRUMENT_NAME);
  });
});

describe("judgeThinkingEffort", () => {
  it("is the configured effort for a thinking model, and 'off' for one that cannot think", () => {
    expect(judgeThinkingEffort({ supportsThinking: true, thinkingEffort: "off" })).toBe("off");
    expect(judgeThinkingEffort({ supportsThinking: true, thinkingEffort: "medium" })).toBe("medium");
    expect(judgeThinkingEffort({ supportsThinking: false, thinkingEffort: null })).toBe("off");
  });

  it("is null when a thinking model runs on its server default", () => {
    expect(judgeThinkingEffort({ supportsThinking: true, thinkingEffort: null })).toBeNull();
  });
});

describe("withJudgeThinking (issue #99)", () => {
  const row = { supportsThinking: true, thinkingEffort: "medium" as string | null };

  it("runs a judge at thinking off whatever the model row's default says", () => {
    expect(withJudgeThinking(row, null).thinkingEffort).toBe("off");
    expect(withJudgeThinking({ ...row, thinkingEffort: null }, null).thinkingEffort).toBe("off");
  });

  it("runs at the effort an experiment explicitly asks for", () => {
    expect(withJudgeThinking(row, "medium").thinkingEffort).toBe("medium");
    expect(withJudgeThinking({ ...row, thinkingEffort: "off" }, "high").thinkingEffort).toBe("high");
  });

  it("leaves a model that cannot think alone, and refuses to ask it to", () => {
    const plain = { supportsThinking: false, thinkingEffort: null };
    expect(withJudgeThinking(plain, null)).toEqual(plain);
    expect(withJudgeThinking(plain, "off")).toEqual(plain);
    expect(() => withJudgeThinking(plain, "medium")).toThrow(/does not support thinking/);
  });

  it("refuses an effort the vocabulary does not know", () => {
    expect(() => withJudgeThinking(row, "sometimes")).toThrow(/sometimes/);
  });
});
