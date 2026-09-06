/**
 * The production instrument is pinned byte for byte (ADR 0003): the judge's
 * prompt and the zoom follow-up's prompt must reproduce these goldens for
 * every specimen shape. A failing test here is the gate on changing the
 * instrument — re-pin deliberately, and expect every stored rating to become
 * Stale.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildEvaluationSystemPrompt, buildUncertainFollowUpPrompt } from "../services/visual-eval-prompt.service.js";
import { JUDGE_PROMPT_FIXTURES, FOLLOW_UP_FIXTURES } from "./support/judge-prompt-fixtures.js";

export const golden = (name: string): string =>
  readFileSync(new URL(`./support/judge-prompt-goldens/${name}.txt`, import.meta.url), "utf8");

describe("the production instrument renders its goldens byte for byte", () => {
  for (const [name, opts] of Object.entries(JUDGE_PROMPT_FIXTURES)) {
    it(`renders ${name}`, () => {
      expect(buildEvaluationSystemPrompt(opts)).toBe(golden(name));
    });
  }
});

describe("the zoom follow-up instrument renders its goldens byte for byte", () => {
  for (const [name, { question, constructionSpec }] of Object.entries(FOLLOW_UP_FIXTURES)) {
    it(`renders ${name}`, () => {
      expect(buildUncertainFollowUpPrompt(question, constructionSpec)).toBe(golden(name));
    });
  }
});
