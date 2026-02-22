// Feature: ux-gaps-conversational-experience, Property 12: Build123d API reference included in codegen prompt
// Feature: ux-gaps-conversational-experience, Property 13: Hot-reload of Build123d API reference
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { buildCodegenPrompt } from "../services/llm.service.js";
import { API_ENTRIES, getBuild123dReference } from "../data/build123d-api-reference.js";
import type { Build123dApiEntry, Build123dExampleSnippet } from "../data/build123d-api-reference.js";

/**
 * Validates: Requirements 7.1
 *
 * Property 12: For any codegen request, the system prompt sent to the LLM
 * should contain the Build123d API reference text, including class names
 * and constructor signatures.
 */

describe("Build123d API reference included in codegen prompt", () => {
  it("system prompt contains all API class names and signatures for any user prompt", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.string({ minLength: 0, maxLength: 500 }),
        (userPrompt, baseFileName, conversationText) => {
          const safeName = baseFileName.replace(/[^a-z0-9-]/gi, "").slice(0, 64) || "model";
          const prompt = buildCodegenPrompt(safeName, userPrompt, conversationText);

          // Every API entry's className and signature must appear in the prompt
          for (const entry of API_ENTRIES) {
            expect(prompt).toContain(entry.className);
            expect(prompt).toContain(entry.signature);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("system prompt contains the API reference header section", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }),
        (userPrompt) => {
          const prompt = buildCodegenPrompt("test-file", userPrompt, "some notes");

          expect(prompt).toContain("Build123d API Reference");
          expect(prompt).toContain("Example Code Snippets");
          expect(prompt).toContain("Do NOT invent or hallucinate classes");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("system prompt includes the user prompt and conversation text", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }),
        fc.string({ minLength: 1, maxLength: 300 }),
        (userPrompt, conversationText) => {
          const prompt = buildCodegenPrompt("file", userPrompt, conversationText);

          expect(prompt).toContain(userPrompt);
          expect(prompt).toContain(conversationText);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Validates: Requirements 7.4
 *
 * Property 13: Hot-reload of Build123d API reference
 *
 * For any update to the Build123d API reference, the next codegen request
 * should use the updated reference content without a service restart.
 * Reading the reference then writing a modified version then reading again
 * should reflect the modification.
 */

vi.mock("../data/build123d-api-reference.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../data/build123d-api-reference.js")>();
  return {
    ...original,
    getBuild123dReference: vi.fn().mockImplementation(original.getBuild123dReference),
  };
});

describe("Hot-reload of Build123d API reference", () => {
  it("next codegen request uses updated API reference content after change", () => {
    const mockedGetRef = vi.mocked(getBuild123dReference);

    // Arbitrary for generating random API entry content
    const apiEntryArb = fc.record({
      className: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
      signature: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      category: fc.constantFrom("primitive", "operation", "boolean", "fillet-chamfer", "sketch", "other") as fc.Arbitrary<Build123dApiEntry["category"]>,
    });

    const exampleSnippetArb = fc.record({
      operation: fc.constantFrom("extrude", "revolve", "boolean", "loft"),
      description: fc.string({ minLength: 1, maxLength: 100 }),
      code: fc.string({ minLength: 1, maxLength: 200 }),
    });

    fc.assert(
      fc.property(
        fc.array(apiEntryArb, { minLength: 1, maxLength: 5 }),
        fc.array(exampleSnippetArb, { minLength: 1, maxLength: 3 }),
        fc.array(apiEntryArb, { minLength: 1, maxLength: 5 }),
        fc.array(exampleSnippetArb, { minLength: 1, maxLength: 3 }),
        (entriesA, examplesA, entriesB, examplesB) => {
          // Simulate first version of the API reference
          mockedGetRef.mockReturnValue({
            entries: entriesA,
            examples: examplesA,
          });

          const promptA = buildCodegenPrompt("model", "make a box", "notes");

          // Verify first version's content is in the prompt
          for (const entry of entriesA) {
            expect(promptA).toContain(entry.className);
            expect(promptA).toContain(entry.signature);
          }

          // Simulate hot-reload: update the API reference to a new version
          mockedGetRef.mockReturnValue({
            entries: entriesB,
            examples: examplesB,
          });

          const promptB = buildCodegenPrompt("model", "make a box", "notes");

          // Verify second version's content is in the prompt
          for (const entry of entriesB) {
            expect(promptB).toContain(entry.className);
            expect(promptB).toContain(entry.signature);
          }

          // The two prompts should differ when the reference content differs
          // (unless by coincidence the generated content is identical)
          if (
            JSON.stringify(entriesA) !== JSON.stringify(entriesB) ||
            JSON.stringify(examplesA) !== JSON.stringify(examplesB)
          ) {
            expect(promptA).not.toEqual(promptB);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
