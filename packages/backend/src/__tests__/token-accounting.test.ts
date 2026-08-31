/**
 * Pure token-accounting helpers (issue #23).
 *
 * The rules these encode were previously spread across llm.service,
 * tracked-llm.service and the streaming progress logs; several copies of one
 * rule is how the producer/consumer drift in #22 happened.
 */
import { describe, it, expect } from "vitest";
import {
  estimateTokensFromChars,
  resolveReasoningTokens,
  totalTokensWithUncountedReasoning,
  uncountedReasoningTokens,
} from "../utils/token-accounting.js";

describe("estimateTokensFromChars", () => {
  it("uses the ~4 chars/token ratio", () => {
    expect(estimateTokensFromChars(600)).toBe(150);
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(1)).toBe(1);
  });
});

describe("resolveReasoningTokens", () => {
  it("prefers a real provider-reported count and does not flag it estimated", () => {
    expect(resolveReasoningTokens(120, 4000)).toEqual({ tokens: 120, estimated: false });
  });

  it("estimates from reasoning characters when the provider reports zero", () => {
    // vLLM never breaks out reasoning tokens, so streamed text is the only signal.
    expect(resolveReasoningTokens(0, 600)).toEqual({ tokens: 150, estimated: true });
  });

  it("reports nothing, and no estimate, when there was no reasoning at all", () => {
    expect(resolveReasoningTokens(0, 0)).toEqual({ tokens: 0, estimated: false });
  });
});

describe("uncountedReasoningTokens", () => {
  it("counts nothing when the completion total already covers the reasoning", () => {
    expect(uncountedReasoningTokens(185, 205)).toBe(0);
    expect(uncountedReasoningTokens(205, 205)).toBe(0);
  });

  it("counts only the excess when reasoning overruns the completion total", () => {
    expect(uncountedReasoningTokens(185, 100)).toBe(85);
  });

  it("counts all of it when the provider reported no completion tokens", () => {
    expect(uncountedReasoningTokens(185, 0)).toBe(185);
  });
});

describe("totalTokensWithUncountedReasoning", () => {
  it("prefers the provider's own total when it reported one", () => {
    expect(totalTokensWithUncountedReasoning({
      reportedTotal: 700, inputTokens: 480, completionTokens: 205, reasoningTokens: 185,
    })).toBe(700);
  });

  it("falls back to input + completion when no total was reported", () => {
    expect(totalTokensWithUncountedReasoning({
      reportedTotal: 0, inputTokens: 480, completionTokens: 205, reasoningTokens: 185,
    })).toBe(685);
  });

  it("adds reasoning the completion total did not already cover", () => {
    expect(totalTokensWithUncountedReasoning({
      reportedTotal: 0, inputTokens: 100, completionTokens: 0, reasoningTokens: 150,
    })).toBe(250);
  });
});

/**
 * Guards the single-home invariant rather than any one call site: the ratio is
 * written once, in estimateTokensFromChars(). Scans the whole backend source
 * tree, since a copy in utils/, routes/ or workers/ would drift just as badly
 * as one in services/.
 */
describe("single definition of the chars-per-token ratio", () => {
  it("leaves no hand-rolled chars-per-token maths anywhere in src", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const root = new URL("../", import.meta.url).pathname;

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(full);
        return entry.name.endsWith(".ts") ? [full] : [];
      });

    const offenders = walk(root)
      .filter(f => !f.endsWith("utils/token-accounting.ts"))
      .filter(f => /Math\.ceil\([^)]*\/\s*4\s*\)/.test(readFileSync(f, "utf8")))
      .map(f => relative(root, f));

    expect(offenders).toEqual([]);
  });
});
