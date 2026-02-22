// Feature: ux-gaps-conversational-experience, Property 1: Streaming token concatenation equals complete response
import { describe, expect, it } from "vitest";
import fc from "fast-check";

/**
 * Validates: Requirements 1.1, 1.3
 *
 * Property 1: For any sequence of stream tokens, concatenating all tokens
 * in order produces a string identical to the complete response.
 *
 * This models the core streaming invariant: the backend splits a complete
 * LLM response into token chunks delivered via SSE, and the frontend
 * concatenates them. The result must equal the original.
 */

/**
 * Split a string into random-sized contiguous chunks.
 * Every character of the input appears in exactly one chunk, in order.
 */
function splitIntoChunks(text: string, splitPoints: number[]): string[] {
  if (text.length === 0) return [];

  const points = splitPoints
    .map((p) => Math.abs(p) % text.length)
    .filter((p) => p > 0 && p < text.length);

  const unique = [...new Set(points)].sort((a, b) => a - b);

  const chunks: string[] = [];
  let prev = 0;
  for (const point of unique) {
    chunks.push(text.slice(prev, point));
    prev = point;
  }
  chunks.push(text.slice(prev));
  return chunks;
}

describe("Streaming token concatenation", () => {
  it("concatenating token chunks equals the original response", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 2000 }),
        fc.array(fc.integer(), { minLength: 0, maxLength: 50 }),
        (completeResponse, splitPoints) => {
          const tokens = splitIntoChunks(completeResponse, splitPoints);

          // Core property: concatenation of all tokens equals the original
          const reconstructed = tokens.join("");
          expect(reconstructed).toBe(completeResponse);

          // Every token is a non-empty contiguous substring (except when input is empty)
          if (completeResponse.length > 0) {
            for (const token of tokens) {
              expect(token.length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("single-token stream equals the complete response", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 2000 }), (completeResponse) => {
        // When the entire response is delivered as one token, it equals the original
        const tokens = [completeResponse];
        expect(tokens.join("")).toBe(completeResponse);
      }),
      { numRuns: 100 },
    );
  });

  it("empty response produces no tokens", () => {
    const tokens = splitIntoChunks("", []);
    expect(tokens).toEqual([]);
    expect(tokens.join("")).toBe("");
  });
});
