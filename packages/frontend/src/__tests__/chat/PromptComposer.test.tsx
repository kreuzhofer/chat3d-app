// @vitest-environment jsdom
// Feature: 001-design-debt-resolution, Property 2: PromptComposer disabled state consistency

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { PromptComposer } from "../../components/chat/PromptComposer";

/* ---------- Generators ---------- */

const busyActionArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constantFrom("submit-prompt", "upload-attachments", "regenerate"),
  fc.string({ minLength: 1, maxLength: 30 }),
);

const promptArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(""),
  fc.constant("   "),
  fc.constant("\t\n"),
  fc.constant("    \n  "),
  fc.string({ minLength: 0, maxLength: 80 }),
);

/* ---------- Helpers ---------- */

const noop = () => {};

/* ---------- Property Test ---------- */

// **Validates: Requirements 1.6**
describe("PromptComposer — Property 2: disabled state consistency", () => {
  afterEach(cleanup);

  it("Send button is disabled iff busyAction is non-null OR trimmed prompt is empty", () => {
    fc.assert(
      fc.property(busyActionArb, promptArb, (busyAction, prompt) => {
        const { unmount } = render(
          <PromptComposer
            prompt={prompt}
            onPromptChange={noop}
            queuedAttachments={[]}
            busyAction={busyAction}
            hasAssistantItems={false}
            activeContextId={null}
            onSubmit={noop}
            onAttachFiles={noop}
            onRemoveAttachment={noop}
            onRegenerate={noop}
          />,
        );

        const sendButton = screen.getByRole("button", { name: /send/i });
        const shouldBeDisabled = busyAction !== null || prompt.trim() === "";

        expect(sendButton.hasAttribute("disabled")).toBe(shouldBeDisabled);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
