// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 3: Typing indicator visible during processing states

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import { TypingIndicator } from "../../components/chat/TypingIndicator";
import type { QueryState } from "../../hooks/useStreamingQuery";

/* ---------- Constants ---------- */

const VISIBLE_STATES: ReadonlySet<QueryState> = new Set([
  "queued",
  "conversation",
  "codegen",
  "rendering",
  "retrying",
]);

const ALL_STATES: QueryState[] = [
  "conversation",
  "codegen",
  "rendering",
  "retrying",
  "completed",
  "failed",
  "queued",
];

/* ---------- Property Test ---------- */

// **Validates: Requirements 2.2**
describe("TypingIndicator — Property 3: Typing indicator visible during processing states", () => {
  afterEach(cleanup);

  it("indicator is visible iff queryState is in {queued, conversation, codegen, rendering, retrying}", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<QueryState | null>(...ALL_STATES, null),
        (queryState) => {
          const { container, unmount } = render(
            createElement(TypingIndicator, { queryState }),
          );

          const shouldBeVisible =
            queryState !== null && VISIBLE_STATES.has(queryState);

          if (shouldBeVisible) {
            // Component should render content (role="status" element)
            const statusEl = container.querySelector('[role="status"]');
            expect(statusEl).not.toBeNull();
          } else {
            // Component should return null (empty container)
            expect(container.innerHTML).toBe("");
          }

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
