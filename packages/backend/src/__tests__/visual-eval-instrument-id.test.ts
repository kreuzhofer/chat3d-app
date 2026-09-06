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

  it("changes with the template", () => {
    const edited = { ...PRODUCTION_INSTRUMENT, template: PRODUCTION_INSTRUMENT.template + "\nBe strict." };
    expect(computeInstrumentId(edited, zoom)).not.toBe(computeInstrumentId(PRODUCTION_INSTRUMENT, zoom));
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
