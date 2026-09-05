/**
 * The production judge prompt must not change when the instrument is split
 * from the specimen (issue #35). These goldens were rendered from the builder
 * as it stood before the split; both production paths — the legacy monolith
 * and the eval-plan scaffold — must reproduce them byte for byte, with and
 * without preamble, construction spec, checklist and zoom block.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildEvaluationSystemPrompt } from "../services/visual-eval-prompt.service.js";
import { JUDGE_PROMPT_FIXTURES } from "./support/judge-prompt-fixtures.js";

export const golden = (name: string): string =>
  readFileSync(new URL(`./support/judge-prompt-goldens/${name}.txt`, import.meta.url), "utf8");

describe("the production judge prompt is unchanged by the instrument/specimen split", () => {
  for (const [name, opts] of Object.entries(JUDGE_PROMPT_FIXTURES)) {
    it(`renders ${name} byte for byte`, () => {
      expect(buildEvaluationSystemPrompt(opts)).toBe(golden(name));
    });
  }
});
