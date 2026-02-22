// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 2: Send button disabled during streaming

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import { PromptComposer } from "../../components/chat/PromptComposer";

/* ---------- Helpers ---------- */

const noop = () => {};

/* ---------- Property Test ---------- */

// **Validates: Requirements 1.5**
describe("PromptComposer — Property 2: Send button disabled during streaming", () => {
  afterEach(cleanup);

  it("Send button is disabled iff isStreaming is true (with non-empty prompt and no busyAction)", () => {
    fc.assert(
      fc.property(fc.boolean(), (isStreaming) => {
        const { unmount } = render(
          createElement(PromptComposer, {
            prompt: "Design a spur gear",
            onPromptChange: noop,
            queuedAttachments: [],
            busyAction: null,
            hasAssistantItems: false,
            activeContextId: null,
            isStreaming,
            onSubmit: noop,
            onAttachFiles: noop,
            onRemoveAttachment: noop,
            onRegenerate: noop,
          }),
        );

        const sendButton = screen.getByRole("button", { name: /send/i });

        expect(sendButton.hasAttribute("disabled")).toBe(isStreaming);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
