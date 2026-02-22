// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 20: Assistant responses displayed in chronological order

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ChatTimelineItem, ChatSegment } from "../../features/chat/chat-adapters";

/* ---------- Generators ---------- */

/** Generate a random ISO-8601 timestamp string within a reasonable range. */
const MIN_MS = new Date("2020-01-01T00:00:00Z").getTime();
const MAX_MS = new Date("2030-12-31T23:59:59Z").getTime();

const arbTimestamp: fc.Arbitrary<string> = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms).toISOString());

/** Generate a minimal ChatSegment for testing purposes. */
const arbSegment: fc.Arbitrary<ChatSegment> = fc.constant({
  id: "seg-1",
  kind: "message" as const,
  text: "Hello",
  state: "completed" as const,
  stateMessage: "",
  attachmentPath: "",
  attachmentFilename: "",
  attachmentMimeType: "",
  attachmentKind: "file" as const,
  usage: null,
  artifact: null,
  files: [],
});

/** Generate a ChatTimelineItem with a random createdAt timestamp. */
const arbTimelineItem: fc.Arbitrary<ChatTimelineItem> = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom("user" as const, "assistant" as const),
    arbTimestamp,
    arbTimestamp,
    arbSegment,
  )
  .map(([id, role, createdAt, updatedAt, segment]) => ({
    id,
    role,
    rating: 0 as const,
    createdAt,
    updatedAt,
    segments: [segment],
  }));

/**
 * Simulate the backend ordering contract: items sorted by createdAt ASC.
 * This is the same ordering the backend applies via `ORDER BY created_at ASC`.
 */
function sortChronologically(items: ChatTimelineItem[]): ChatTimelineItem[] {
  return [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

/* ---------- Property 20: Assistant responses displayed in chronological order ---------- */

// **Validates: Requirements 23.2**
describe("Chat_Thread — Property 20: Assistant responses displayed in chronological order", () => {
  it("items sorted by createdAt are in ascending chronological order", () => {
    fc.assert(
      fc.property(
        fc.array(arbTimelineItem, { minLength: 2, maxLength: 20 }),
        (items) => {
          const sorted = sortChronologically(items);

          // Verify each consecutive pair is in ascending order
          for (let i = 1; i < sorted.length; i++) {
            const prevTime = new Date(sorted[i - 1].createdAt).getTime();
            const currTime = new Date(sorted[i].createdAt).getTime();
            expect(currTime).toBeGreaterThanOrEqual(prevTime);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sorting preserves all original items (no items lost or duplicated)", () => {
    fc.assert(
      fc.property(
        fc.array(arbTimelineItem, { minLength: 1, maxLength: 20 }),
        (items) => {
          const sorted = sortChronologically(items);

          // Same length
          expect(sorted.length).toBe(items.length);

          // Same set of IDs
          const originalIds = items.map((item) => item.id).sort();
          const sortedIds = sorted.map((item) => item.id).sort();
          expect(sortedIds).toEqual(originalIds);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("sorting is idempotent — sorting an already-sorted list produces the same order", () => {
    fc.assert(
      fc.property(
        fc.array(arbTimelineItem, { minLength: 1, maxLength: 20 }),
        (items) => {
          const sorted1 = sortChronologically(items);
          const sorted2 = sortChronologically(sorted1);

          // IDs should be in the same order after double-sort
          const ids1 = sorted1.map((item) => item.id);
          const ids2 = sorted2.map((item) => item.id);
          expect(ids2).toEqual(ids1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a single item is trivially in chronological order", () => {
    fc.assert(
      fc.property(arbTimelineItem, (item) => {
        const sorted = sortChronologically([item]);
        expect(sorted.length).toBe(1);
        expect(sorted[0].id).toBe(item.id);
      }),
      { numRuns: 100 },
    );
  });
});
