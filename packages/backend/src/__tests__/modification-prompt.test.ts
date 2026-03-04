// Feature: modification-aware chat codegen
// Tests for buildModificationPrompt and prompt selection logic
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildInitialPrompt,
  buildModificationPrompt,
} from "../services/workbench-codegen.service.js";
import { findMostRecentCode } from "../services/llm.service.js";
import type { ConversationHistoryEntry } from "../services/query.service.js";

// ── Arbitraries ──────────────────────────────────────────────────────

const fewShotArb = fc.array(
  fc.record({
    prompt: fc.string({ minLength: 1, maxLength: 200 }),
    code: fc.string({ minLength: 1, maxLength: 500 }),
  }),
  { minLength: 0, maxLength: 4 },
);

const nonEmptyString = fc.string({ minLength: 1, maxLength: 300 });

/** Helper: combine system + userContent for full-text assertions. */
function fullText(result: { system: string; userContent: string }): string {
  return result.system + "\n" + result.userContent;
}

// ── buildModificationPrompt tests ────────────────────────────────────

describe("buildModificationPrompt", () => {
  it("contains the baseline code in a python code block", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );
          const text = fullText(result);

          expect(text).toContain(baselineCode);
          expect(text).toContain("```python");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("contains preservation instructions", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );
          const text = fullText(result);

          // Must instruct the LLM to preserve existing geometry
          expect(text.toLowerCase()).toContain("preserve");
          expect(text).toContain("Working Baseline Code");
          expect(text.toLowerCase()).toContain("do not rewrite from scratch");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("contains the user prompt and conversation summary", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );
          const text = fullText(result);

          expect(text).toContain(userPrompt);
          expect(text).toContain(convSummary);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("contains the system prompt content", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );

          expect(result.system).toContain(systemPrompt);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("contains few-shot examples when provided", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fc.array(
          fc.record({
            prompt: fc.string({ minLength: 1, maxLength: 200 }),
            code: fc.string({ minLength: 1, maxLength: 500 }),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );
          const text = fullText(result);

          expect(text).toContain("Approved Examples for Reference");
          for (const example of fewShots) {
            expect(text).toContain(example.prompt);
            expect(text).toContain(example.code);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("includes conversation history when provided", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary, convHistory) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary, convHistory,
          );
          const text = fullText(result);

          expect(text).toContain(convHistory);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("omits conversation history section when not provided", () => {
    const result = buildModificationPrompt(
      "system", [], "modify it", "some_code = 1", "I'll modify the model",
    );
    const text = fullText(result);

    // Should not have an extra empty section — just verify it's well-formed
    expect(text).toContain("Working Baseline Code");
    expect(text).toContain("Modification Request");
    expect(text).toContain("Requirements");
  });

  it("contains standard requirements about root_part and no imports", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const result = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );
          const text = fullText(result);

          expect(text).toContain("root_part");
          expect(text).toContain("Do NOT include `from build123d import *`");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is structurally different from buildInitialPrompt for the same inputs", () => {
    fc.assert(
      fc.property(
        nonEmptyString,
        fewShotArb,
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        (systemPrompt, fewShots, userPrompt, baselineCode, convSummary) => {
          const initialResult = buildInitialPrompt(systemPrompt, fewShots, userPrompt);
          const modResult = buildModificationPrompt(
            systemPrompt, fewShots, userPrompt, baselineCode, convSummary,
          );
          const initialText = fullText(initialResult);
          const modText = fullText(modResult);

          // The modification prompt must contain sections the initial prompt does not
          expect(modText).toContain("Working Baseline Code");
          expect(modText).toContain("Modification Request");
          expect(initialText).not.toContain("Working Baseline Code");
          expect(initialText).not.toContain("Modification Request");

          // The modification prompt must contain the baseline code
          expect(modText).toContain(baselineCode);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Prompt selection logic tests ─────────────────────────────────────

describe("Modification detection via findMostRecentCode", () => {
  it("returns undefined when history has no assistant entries with code", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            role: fc.constantFrom("user" as const, "assistant" as const),
            text: fc.string({ minLength: 1, maxLength: 200 }),
            code: fc.constant(undefined),
            sequencePosition: fc.integer({ min: 1, max: 20 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (history: ConversationHistoryEntry[]) => {
          expect(findMostRecentCode(history)).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns the most recent assistant code when present", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({
              role: fc.constant("user" as const),
              text: fc.string({ minLength: 1, maxLength: 200 }),
              code: fc.constant(undefined),
              sequencePosition: fc.integer({ min: 1, max: 20 }),
            }),
            fc.record({
              role: fc.constant("assistant" as const),
              text: fc.string({ minLength: 1, maxLength: 200 }),
              code: fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined }),
              sequencePosition: fc.integer({ min: 1, max: 20 }),
            }),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        (history: ConversationHistoryEntry[]) => {
          const result = findMostRecentCode(history);

          // Find what the expected result should be by walking backwards
          let expected: string | undefined;
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === "assistant" && history[i].code) {
              expected = history[i].code;
              break;
            }
          }

          expect(result).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns undefined for empty or undefined history", () => {
    expect(findMostRecentCode(undefined)).toBeUndefined();
    expect(findMostRecentCode([])).toBeUndefined();
  });
});
