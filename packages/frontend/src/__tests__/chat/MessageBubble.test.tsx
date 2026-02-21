// @vitest-environment jsdom
// Feature: 001-design-debt-resolution, Property 1: MessageBubble renders role and text content

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { ChatSegment, ChatSegmentKind, ChatTimelineItem } from "../../features/chat/chat-adapters";
import { MessageBubble } from "../../components/chat/MessageBubble";

// Stub ReactMarkdown to render children as plain text (avoids ESM/async issues in jsdom)
vi.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <span data-testid="markdown">{children}</span>,
}));

vi.mock("remark-gfm", () => ({
  __esModule: true,
  default: {},
}));

/* ---------- Generators ---------- */

const segmentKindArb: fc.Arbitrary<ChatSegmentKind> = fc.constantFrom(
  "message",
  "error",
  "meta",
  "model",
  "attachment",
);

function segmentArb(index: number): fc.Arbitrary<ChatSegment> {
  return fc.record({
    id: fc.constant(`seg-${index}`),
    kind: segmentKindArb,
    text: fc.oneof(fc.constant(""), fc.string({ minLength: 1, maxLength: 80 })),
    state: fc.constantFrom("pending" as const, "completed" as const, "error" as const, "unknown" as const),
    stateMessage: fc.constant(""),
    attachmentPath: fc.constant(""),
    attachmentFilename: fc.constant(""),
    attachmentMimeType: fc.constant(""),
    attachmentKind: fc.constantFrom("file" as const, "image" as const),
    usage: fc.constant(null),
    artifact: fc.constant(null),
    files: fc.constant([]),
  });
}

const chatTimelineItemArb: fc.Arbitrary<ChatTimelineItem> = fc
  .integer({ min: 1, max: 5 })
  .chain((segCount) =>
    fc.record({
      id: fc.constant("item-prop"),
      role: fc.constantFrom("user" as const, "assistant" as const),
      rating: fc.constantFrom(-1 as const, 0 as const, 1 as const),
      createdAt: fc.constant("2025-01-01T00:00:00.000Z"),
      updatedAt: fc.constant("2025-01-01T00:00:00.000Z"),
      segments: fc.tuple(...Array.from({ length: segCount }, (_, i) => segmentArb(i))),
    }),
  );

/* ---------- Helpers ---------- */

const noopSelect = () => {};
const noopRate = () => {};
const noopRegenerate = () => {};
const noopDownload = () => {};

/* ---------- Property Test ---------- */

// **Validates: Requirements 1.5**
describe("MessageBubble — Property 1: renders role and text content", () => {
  afterEach(cleanup);

  it("always renders the role indicator and all non-empty segment text", () => {
    fc.assert(
      fc.property(chatTimelineItemArb, (item) => {
        const { container } = render(
          <MessageBubble
            item={item}
            isSelected={false}
            busyAction={null}
            onSelect={noopSelect}
            onRate={noopRate}
            onRegenerate={noopRegenerate}
            onDownloadFile={noopDownload}
          />,
        );

        const text = container.textContent ?? "";

        // Role indicator must be present (rendered uppercase in the component)
        expect(text.toLowerCase()).toContain(item.role);

        // Every non-empty segment text must appear in the rendered output
        for (const segment of item.segments) {
          if (segment.text && segment.text.trim().length > 0) {
            expect(text).toContain(segment.text);
          }
        }

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
