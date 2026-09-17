/**
 * #108's one-sided rule (issue #111): a third judge's C is a training label —
 * Fable at any confidence, anyone else at high; R and N are the human's;
 * a recorded decision is never touched.
 */
import { describe, it, expect } from "vitest";
import { autoDecision } from "../services/adjudication-pre-decide.js";

const item = (o: Partial<Parameters<typeof autoDecision>[0]>) => ({ decision: null, triageVerdict: "C", triageConfidence: "high", triageModel: "Claude Fable 5.1 (Claude Code session, from the stored views)", ...o });

describe("autoDecision", () => {
  it("records C when Fable sides with the incumbent, at any confidence", () => {
    expect(autoDecision(item({}))?.decision).toBe("C");
    expect(autoDecision(item({ triageConfidence: "medium" }))?.decision).toBe("C");
    expect(autoDecision(item({ triageConfidence: null }))?.decision).toBe("C");
  });
  it("records C for another third judge only at high confidence", () => {
    expect(autoDecision(item({ triageModel: "nebius/moonshotai/Kimi-K3" }))?.decision).toBe("C");
    expect(autoDecision(item({ triageModel: "nebius/moonshotai/Kimi-K3", triageConfidence: "medium" }))).toBeNull();
  });
  it("refuses an R-side or N reading, whoever read it", () => {
    expect(autoDecision(item({ triageVerdict: "R" }))).toBeNull();
    expect(autoDecision(item({ triageVerdict: "N" }))).toBeNull();
    expect(autoDecision(item({ triageVerdict: null }))).toBeNull();
  });
  it("never touches a recorded decision", () => {
    expect(autoDecision(item({ decision: "R" }))).toBeNull();
    expect(autoDecision(item({ decision: "C" }))).toBeNull();
  });
  it("names the rule in the note", () => {
    expect(autoDecision(item({}))?.note).toMatch(/#108/);
  });
});
