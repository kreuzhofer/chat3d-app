/**
 * Reusing the agent's in-loop evaluation (#120 finding): when the codegen agent
 * submits, the pipeline stores the evaluation the agent ran instead of running
 * another. It dropped the item answers — `checklistResults` and
 * `codeItemResults` — so 96% of freshly generated rows stored no items, the
 * Gate could not decide them (they stayed pending) and the draw could not
 * take them. The reuse carries every field the Gate and the draw read.
 */
import { describe, it, expect } from "vitest";
import { fullEvalFromAgent } from "../services/agent-eval-reuse.js";
import type { AgentEvalResult } from "../services/agent-render-helpers.service.js";

const agentEval = (over: Partial<AgentEvalResult> = {}): AgentEvalResult => ({
  score: 7.5, visualScore: 8, codeScore: 7, assertionPassRate: 1, vlmModel: "rc0", codeReviewModel: "qwen",
  issues: ["a visual issue", "[CODE] a code issue"], suggestions: ["s"], screenshots: [],
  vlmInstrumentId: "production@4892d8d1b160", judgeOutcome: "rated",
  checklistResults: [{ question: "Q1", pass: true, detail: "d1" }, { question: "Q2", pass: false, detail: "d2" }, { question: "Q3", pass: true, detail: "d3" }],
  codeItemResults: [{ criterion: "C1", pass: true, detail: "c1" }] as unknown as AgentEvalResult["codeItemResults"],
  ...over,
});

describe("fullEvalFromAgent", () => {
  it("carries the visual judge's item answers and the code reviewer's items", () => {
    const e = agentEval();
    const full = fullEvalFromAgent(e);
    expect(full.checklistResults).toEqual(e.checklistResults);
    expect(full.codeItemResults).toEqual(e.codeItemResults);
  });
  it("keeps scores, provenance and the issue split", () => {
    const full = fullEvalFromAgent(agentEval());
    expect(full).toMatchObject({ compositeScore: 7.5, visualScore: 8, codeScore: 7, source: "agent_submitted", vlmInstrumentId: "production@4892d8d1b160", judgeOutcome: "rated" });
    expect(full.vlmIssues).toEqual(["a visual issue"]);
    expect(full.codeIssues).toEqual(["[CODE] a code issue"]);
  });
  it("reads the outcome off the score for a result that predates it", () => {
    expect(fullEvalFromAgent(agentEval({ judgeOutcome: undefined })).judgeOutcome).toBe("rated");
    expect(fullEvalFromAgent(agentEval({ judgeOutcome: undefined, visualScore: null })).judgeOutcome).toBe("skipped_no_images");
  });
});
