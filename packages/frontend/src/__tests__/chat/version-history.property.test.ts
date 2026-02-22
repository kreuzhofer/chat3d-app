// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 19: Model version history lists all artifact-bearing assistant items

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  ChatTimelineItem,
  ChatSegment,
  ChatFileEntry,
} from "../../features/chat/chat-adapters";
import { buildModelVersionEntries } from "../../components/chat/utils";

/* ---------- Generators ---------- */

const PREVIEW_EXTENSIONS = [".stl", ".3mf"];
const OTHER_EXTENSIONS = [".step", ".b123d", ".txt", ".json"];
const ALL_EXTENSIONS = [...PREVIEW_EXTENSIONS, ...OTHER_EXTENSIONS];

/** Generate a random file entry with a given extension. */
const arbFileEntry = (ext: string): fc.Arbitrary<ChatFileEntry> =>
  fc.string({ minLength: 1, maxLength: 20 }).map((name) => ({
    path: `modelcreator/${name}${ext}`,
    filename: `${name}${ext}`,
  }));

/** Generate a random list of file entries (possibly empty). */
const arbFileList: fc.Arbitrary<ChatFileEntry[]> = fc
  .array(
    fc.constantFrom(...ALL_EXTENSIONS).chain((ext) => arbFileEntry(ext)),
    { minLength: 0, maxLength: 5 },
  );

/** Generate a file list guaranteed to have at least one file. */
const arbNonEmptyFileList: fc.Arbitrary<ChatFileEntry[]> = fc
  .array(
    fc.constantFrom(...ALL_EXTENSIONS).chain((ext) => arbFileEntry(ext)),
    { minLength: 1, maxLength: 5 },
  );

/** Generate a minimal ChatSegment with optional files. */
const arbSegment = (files: ChatFileEntry[], text = "Hello"): ChatSegment => ({
  id: "seg-1",
  kind: "message" as const,
  text,
  state: "completed" as const,
  stateMessage: "",
  attachmentPath: "",
  attachmentFilename: "",
  attachmentMimeType: "",
  attachmentKind: "file" as const,
  usage: null,
  artifact: null,
  files,
});

const MIN_MS = new Date("2020-01-01T00:00:00Z").getTime();
const MAX_MS = new Date("2030-12-31T23:59:59Z").getTime();

const arbTimestamp: fc.Arbitrary<string> = fc
  .integer({ min: MIN_MS, max: MAX_MS })
  .map((ms) => new Date(ms).toISOString());

/** Generate a user timeline item with message text. */
const arbUserItem = (text: string, createdAt: string): fc.Arbitrary<ChatTimelineItem> =>
  fc.uuid().map((id) => ({
    id,
    role: "user" as const,
    rating: 0 as const,
    createdAt,
    updatedAt: createdAt,
    segments: [arbSegment([], text)],
  }));

/** Generate an assistant timeline item with given files. */
const arbAssistantItem = (
  files: ChatFileEntry[],
  createdAt: string,
): fc.Arbitrary<ChatTimelineItem> =>
  fc.uuid().map((id) => ({
    id,
    role: "assistant" as const,
    rating: 0 as const,
    createdAt,
    updatedAt: createdAt,
    segments: [arbSegment(files, "Here is your model")],
  }));

/**
 * Generate a realistic timeline: alternating user/assistant pairs,
 * with some assistant items having files and some not.
 */
const arbTimeline: fc.Arbitrary<ChatTimelineItem[]> = fc
  .array(
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 40 }),
      arbFileList,
      arbTimestamp,
    ),
    { minLength: 1, maxLength: 10 },
  )
  .chain((pairs) => {
    // Sort timestamps to ensure chronological order
    const sorted = [...pairs].sort(
      (a, b) => new Date(a[2]).getTime() - new Date(b[2]).getTime(),
    );

    const itemArbs: fc.Arbitrary<ChatTimelineItem>[] = [];
    for (const [userText, files, ts] of sorted) {
      // User item slightly before assistant
      const userTs = new Date(new Date(ts).getTime() - 1000).toISOString();
      itemArbs.push(arbUserItem(userText, userTs));
      itemArbs.push(arbAssistantItem(files, ts));
    }
    return fc.tuple(...(itemArbs as [fc.Arbitrary<ChatTimelineItem>, ...fc.Arbitrary<ChatTimelineItem>[]]));
  })
  .map((items) => [...items]);

/* ---------- Helpers ---------- */

/** Check if an assistant item has files (same logic as buildModelVersionEntries). */
function hasFiles(item: ChatTimelineItem): boolean {
  const allFiles = item.segments.flatMap((seg) => seg.files);
  const uniquePaths = new Set(allFiles.map((f) => f.path).filter(Boolean));
  return uniquePaths.size > 0;
}

/* ---------- Property 19: Model version history lists all artifact-bearing assistant items ---------- */

// **Validates: Requirements 12.1**
describe("WorkbenchPane — Property 19: Model version history lists all artifact-bearing assistant items", () => {
  it("returns entries only for assistant items that have files", () => {
    fc.assert(
      fc.property(arbTimeline, (items) => {
        const entries = buildModelVersionEntries(items);

        // Count assistant items with files
        const assistantWithFiles = items.filter(
          (item) => item.role === "assistant" && hasFiles(item),
        );

        expect(entries.length).toBe(assistantWithFiles.length);

        // Each entry's assistantItemId should match an assistant item with files
        for (const entry of entries) {
          const source = items.find((item) => item.id === entry.assistantItemId);
          expect(source).toBeDefined();
          expect(source!.role).toBe("assistant");
          expect(hasFiles(source!)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("entries are in chronological order (same order as input)", () => {
    fc.assert(
      fc.property(arbTimeline, (items) => {
        const entries = buildModelVersionEntries(items);

        // Entries should preserve input order (which is chronological)
        for (let i = 1; i < entries.length; i++) {
          const prevTs = new Date(entries[i - 1].timestamp).getTime();
          const currTs = new Date(entries[i].timestamp).getTime();
          expect(currTs).toBeGreaterThanOrEqual(prevTs);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("sequence numbers are incrementing from 1", () => {
    fc.assert(
      fc.property(arbTimeline, (items) => {
        const entries = buildModelVersionEntries(items);

        for (let i = 0; i < entries.length; i++) {
          expect(entries[i].sequenceNumber).toBe(i + 1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("prompt summaries come from preceding user items", () => {
    fc.assert(
      fc.property(arbTimeline, (items) => {
        const entries = buildModelVersionEntries(items);

        for (const entry of entries) {
          const assistantIdx = items.findIndex((item) => item.id === entry.assistantItemId);
          expect(assistantIdx).toBeGreaterThanOrEqual(0);

          // Find the preceding user item
          let precedingUserText = "";
          for (let j = assistantIdx - 1; j >= 0; j--) {
            if (items[j].role === "user") {
              precedingUserText = items[j].segments
                .filter((seg) => seg.kind === "message")
                .map((seg) => seg.text)
                .join(" ")
                .trim();
              break;
            }
          }

          if (precedingUserText) {
            // promptSummary should be a prefix of the user text (possibly truncated)
            if (precedingUserText.length <= 80) {
              expect(entry.promptSummary).toBe(precedingUserText);
            } else {
              expect(entry.promptSummary).toBe(
                precedingUserText.slice(0, 80).trimEnd() + "…",
              );
            }
          } else {
            expect(entry.promptSummary).toBe("No prompt available");
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("assistant items without files are excluded", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.uuid(), arbTimestamp),
          { minLength: 1, maxLength: 5 },
        ),
        (pairs) => {
          // Create assistant items with no files
          const items: ChatTimelineItem[] = pairs.map(([id, ts]) => ({
            id,
            role: "assistant" as const,
            rating: 0 as const,
            createdAt: ts,
            updatedAt: ts,
            segments: [arbSegment([])],
          }));

          const entries = buildModelVersionEntries(items);
          expect(entries.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("timestamp matches the assistant item's createdAt", () => {
    fc.assert(
      fc.property(arbTimeline, (items) => {
        const entries = buildModelVersionEntries(items);

        for (const entry of entries) {
          const source = items.find((item) => item.id === entry.assistantItemId);
          expect(source).toBeDefined();
          expect(entry.timestamp).toBe(source!.createdAt);
        }
      }),
      { numRuns: 100 },
    );
  });
});
