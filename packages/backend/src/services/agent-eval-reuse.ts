/**
 * The agent's in-loop evaluation as the pipeline's full evaluation.
 *
 * When the codegen agent submits, it has already run the full evaluation
 * (assertions + code review + visual judge + composite) inside submit_result,
 * and the pipeline stores that instead of running another. Every field the
 * Gate and the draw read has to come across: until #120 found it, the item
 * answers did not, and 96% of freshly generated rows were stored without
 * items — undecidable by the Gate, invisible to the draw.
 */
import type { FullEvalResult } from "./eval-orchestrator.service.js";
import type { AgentEvalResult } from "./agent-render-helpers.service.js";

export function fullEvalFromAgent(e: AgentEvalResult): FullEvalResult {
  return {
    compositeScore: e.score,
    visualScore: e.visualScore,
    // The agent ran the same pipeline; carry its outcome, or read it off the
    // score for a result produced before the outcome was recorded.
    judgeOutcome: e.judgeOutcome ?? (e.visualScore !== null ? "rated" : "skipped_no_images"),
    codeScore: e.codeScore,
    assertionPassRate: e.assertionPassRate,
    assertionsFailed: false, // agent wouldn't have submitted if assertions failed
    source: "agent_submitted",
    compositeWeightSource: null,
    vlmIssues: e.issues.filter((i) => !i.startsWith("[CODE]")),
    vlmSuggestions: e.suggestions,
    codeIssues: e.issues.filter((i) => i.startsWith("[CODE]")),
    checklistResults: e.checklistResults,
    codeItemResults: e.codeItemResults,
    vlmModel: e.vlmModel,
    codeReviewModel: e.codeReviewModel,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    vlmRawResponse: e.vlmRawResponse,
    vlmReasoning: e.vlmReasoning,
    vlmSystemPrompt: e.vlmSystemPrompt,
    vlmInstrumentId: e.vlmInstrumentId ?? null,
    vlmThinkingEffort: e.vlmThinkingEffort ?? null,
    evalChecklistState: e.evalChecklistState ?? null,
    codeReviewRawResponse: e.codeReviewRawResponse,
    codeReviewReasoning: e.codeReviewReasoning,
    codeReviewSystemPrompt: e.codeReviewSystemPrompt,
  };
}
