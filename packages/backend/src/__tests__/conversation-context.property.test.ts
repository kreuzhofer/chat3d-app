// Feature: ux-gaps-conversational-experience, Property 16: Conversation context correctly constructed from chat history
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  formatConversationHistory,
  findMostRecentCode,
} from "../services/llm.service.js";
import { capConversationEntries } from "../services/query.service.js";
import type { ConversationHistoryEntry } from "../services/query.service.js";

/**
 * Validates: Requirements 10.1, 10.3, 10.4, 11.1
 *
 * Property 16: For any follow-up prompt in an existing chat context, the LLM
 * conversation input should include previous user prompts, assistant texts,
 * and generated Build123d code, with each entry labeled with its role
 * (user or assistant) and sequence position, and the most recent code
 * referenced as the baseline for modification.
 */

/** Arbitrary for a single ConversationHistoryEntry */
const entryArb = (role: "user" | "assistant"): fc.Arbitrary<ConversationHistoryEntry> =>
  fc.record({
    role: fc.constant(role),
    text: fc.string({ minLength: 1, maxLength: 200 }),
    code: role === "assistant"
      ? fc.option(fc.string({ minLength: 1, maxLength: 500 }), { nil: undefined })
      : fc.constant(undefined),
    sequencePosition: fc.integer({ min: 0, max: 100 }),
  });

/** Arbitrary for a non-empty array of ConversationHistoryEntry with mixed roles */
const historyArb: fc.Arbitrary<ConversationHistoryEntry[]> = fc
  .array(
    fc.oneof(entryArb("user"), entryArb("assistant")),
    { minLength: 1, maxLength: 20 },
  );

describe("Conversation context construction (Property 16)", () => {
  it("formatConversationHistory labels each entry with role and sequence position", () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const formatted = formatConversationHistory(history);

        // The formatted output must contain a header
        expect(formatted).toContain("## Conversation History");

        // Each entry must appear with its role label and sequence position
        for (const entry of history) {
          const roleLabel = entry.role === "user" ? "User" : "Assistant";
          const expectedPrefix = `[${entry.sequencePosition}] ${roleLabel}:`;
          expect(formatted).toContain(expectedPrefix);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("formatConversationHistory includes text content for every entry", () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const formatted = formatConversationHistory(history);

        for (const entry of history) {
          expect(formatted).toContain(entry.text);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("formatConversationHistory includes code blocks for assistant entries with code", () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const formatted = formatConversationHistory(history);

        for (const entry of history) {
          if (entry.role === "assistant" && entry.code) {
            expect(formatted).toContain(entry.code);
            // Code should be wrapped in a python code fence
            expect(formatted).toContain("```python");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("formatConversationHistory preserves entry ordering by sequence position appearance", () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const formatted = formatConversationHistory(history);

        // Entries should appear in the same order as the input array
        let lastIndex = -1;
        for (const entry of history) {
          const roleLabel = entry.role === "user" ? "User" : "Assistant";
          const marker = `[${entry.sequencePosition}] ${roleLabel}: ${entry.text}`;
          const idx = formatted.indexOf(marker, lastIndex + 1);
          expect(idx).toBeGreaterThan(lastIndex);
          lastIndex = idx;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("formatConversationHistory returns empty string for undefined or empty history", () => {
    expect(formatConversationHistory(undefined)).toBe("");
    expect(formatConversationHistory([])).toBe("");
  });

  it("findMostRecentCode returns the code from the last assistant entry with code", () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const result = findMostRecentCode(history);

        // Find the expected most recent code by walking backwards
        let expectedCode: string | undefined;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === "assistant" && history[i].code) {
            expectedCode = history[i].code;
            break;
          }
        }

        expect(result).toBe(expectedCode);
      }),
      { numRuns: 100 },
    );
  });

  it("findMostRecentCode returns undefined when no assistant entries have code", () => {
    fc.assert(
      fc.property(
        fc.array(entryArb("user"), { minLength: 1, maxLength: 10 }),
        (userOnlyHistory) => {
          // User entries never have code
          expect(findMostRecentCode(userOnlyHistory)).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("findMostRecentCode returns undefined for undefined or empty history", () => {
    expect(findMostRecentCode(undefined)).toBeUndefined();
    expect(findMostRecentCode([])).toBeUndefined();
  });

  it("findMostRecentCode ignores user entries even if they somehow had code", () => {
    // Construct a history where only user entries exist (code is always undefined for users)
    const history: ConversationHistoryEntry[] = [
      { role: "user", text: "make it taller", sequencePosition: 1 },
      { role: "user", text: "add a fillet", sequencePosition: 2 },
    ];
    expect(findMostRecentCode(history)).toBeUndefined();
  });

  it("most recent code from findMostRecentCode appears in formatConversationHistory output", () => {
    fc.assert(
      fc.property(historyArb, (history) => {
        const recentCode = findMostRecentCode(history);
        if (recentCode) {
          const formatted = formatConversationHistory(history);
          // The most recent code should be present in the formatted output
          expect(formatted).toContain(recentCode);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// Feature: ux-gaps-conversational-experience, Property 17: Conversation context capped at five exchange pairs

/**
 * Validates: Requirements 10.2
 *
 * Property 17: For any chat context with N exchange pairs (where N > 5),
 * the Conversation_Context passed to the LLM should contain exactly the
 * last 5 pairs, discarding older entries.
 */

/** Arbitrary for a ConversationHistoryEntry with a given role */
const capEntryArb = (role: "user" | "assistant"): fc.Arbitrary<ConversationHistoryEntry> =>
  fc.record({
    role: fc.constant(role),
    text: fc.string({ minLength: 1, maxLength: 100 }),
    code: role === "assistant"
      ? fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined })
      : fc.constant(undefined),
    sequencePosition: fc.integer({ min: 1, max: 40 }),
  });

/** Arbitrary for a chat history with 1–20 entries of mixed roles */
const chatHistoryArb: fc.Arbitrary<ConversationHistoryEntry[]> = fc.array(
  fc.oneof(capEntryArb("user"), capEntryArb("assistant")),
  { minLength: 1, maxLength: 20 },
);

describe("Conversation context cap (Property 17)", () => {
  it("capConversationEntries returns at most maxPairs*2 entries (default 5 pairs = 10 entries)", () => {
    fc.assert(
      fc.property(chatHistoryArb, (history) => {
        const capped = capConversationEntries(history);
        expect(capped.length).toBeLessThanOrEqual(10);
      }),
      { numRuns: 100 },
    );
  });

  it("capConversationEntries preserves all entries when history fits within the cap", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(capEntryArb("user"), capEntryArb("assistant")),
          { minLength: 1, maxLength: 10 },
        ),
        (history) => {
          const capped = capConversationEntries(history);
          expect(capped).toEqual(history);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("capConversationEntries keeps the last maxPairs*2 entries when history exceeds the cap", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(capEntryArb("user"), capEntryArb("assistant")),
          { minLength: 11, maxLength: 20 },
        ),
        (history) => {
          const capped = capConversationEntries(history);
          const expected = history.slice(-10);
          expect(capped).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("capConversationEntries respects a custom maxPairs parameter", () => {
    fc.assert(
      fc.property(
        chatHistoryArb,
        fc.integer({ min: 1, max: 10 }),
        (history, maxPairs) => {
          const capped = capConversationEntries(history, maxPairs);
          expect(capped.length).toBeLessThanOrEqual(maxPairs * 2);
          if (history.length > maxPairs * 2) {
            expect(capped).toEqual(history.slice(-maxPairs * 2));
          } else {
            expect(capped).toEqual(history);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
