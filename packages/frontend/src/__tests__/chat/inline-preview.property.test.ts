// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 4: Inline 3D preview rendered when preview-ready artifacts present

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import type { ChatFileEntry, ChatSegment, ChatTimelineItem } from "../../features/chat/chat-adapters";
import { MessageBubble } from "../../components/chat/MessageBubble";

// Mock InlineModelViewer (uses Three.js, unavailable in jsdom)
vi.mock("../../components/chat/InlineModelViewer", () => ({
  InlineModelViewer: ({ filePath }: { filePath: string }) =>
    createElement("div", { "data-testid": "inline-model-viewer-mock", "data-file": filePath }),
}));

// Mock ReactMarkdown and remark-gfm (ESM/async issues in jsdom)
vi.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => createElement("span", null, children),
}));

vi.mock("remark-gfm", () => ({
  __esModule: true,
  default: {},
}));

/* ---------- Generators ---------- */

const PREVIEW_EXTENSIONS = [".stl", ".3mf"];
const NON_PREVIEW_EXTENSIONS = [".step", ".stp", ".b123d", ".txt", ".py", ".json", ".obj"];

const previewExtArb = fc.constantFrom(...PREVIEW_EXTENSIONS);
const nonPreviewExtArb = fc.constantFrom(...NON_PREVIEW_EXTENSIONS);

function fileEntryArb(ext: string): fc.Arbitrary<ChatFileEntry> {
  return fc.string({ minLength: 1, maxLength: 20, unit: "grapheme-ascii" }).map((name) => ({
    path: `modelcreator/${name}${ext}`,
    filename: `${name}${ext}`,
  }));
}

function segmentWithFilesArb(files: fc.Arbitrary<ChatFileEntry[]>): fc.Arbitrary<ChatSegment> {
  return files.map((f) => ({
    id: "seg-0",
    kind: "message" as const,
    text: "Here is your model",
    state: "completed" as const,
    stateMessage: "",
    attachmentPath: "",
    attachmentFilename: "",
    attachmentMimeType: "",
    attachmentKind: "file" as const,
    usage: null,
    artifact: null,
    files: f,
  }));
}

function timelineItemArb(segment: fc.Arbitrary<ChatSegment>): fc.Arbitrary<ChatTimelineItem> {
  return segment.map((seg) => ({
    id: "item-preview-test",
    role: "assistant" as const,
    rating: 0 as const,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    segments: [seg],
  }));
}

/* ---------- Helpers ---------- */

const noop = () => {};

function hasPreviewExtension(files: ChatFileEntry[]): boolean {
  return files.some((f) => {
    const ext = f.path.toLowerCase();
    return ext.endsWith(".stl") || ext.endsWith(".3mf");
  });
}

/* ---------- Property Test ---------- */

// **Validates: Requirements 3.1**
describe("MessageBubble — Property 4: Inline 3D preview rendered when preview-ready artifacts present", () => {
  afterEach(cleanup);

  it("renders InlineModelViewer iff assistant response has .stl or .3mf files", () => {
    // Generate a mix of preview and non-preview files
    const mixedFilesArb = fc
      .tuple(
        fc.array(previewExtArb.chain((ext) => fileEntryArb(ext)), { minLength: 0, maxLength: 3 }),
        fc.array(nonPreviewExtArb.chain((ext) => fileEntryArb(ext)), { minLength: 0, maxLength: 3 }),
      )
      .map(([preview, nonPreview]) => [...preview, ...nonPreview]);

    const itemArb = timelineItemArb(segmentWithFilesArb(mixedFilesArb));

    fc.assert(
      fc.property(itemArb, (item) => {
        const allFiles = item.segments.flatMap((s) => s.files);
        const expectPreview = hasPreviewExtension(allFiles);

        const { unmount } = render(
          createElement(MessageBubble, {
            item,
            isSelected: false,
            busyAction: null,
            token: "test-token",
            onSelect: noop,
            onRate: noop,
            onRegenerate: noop,
            onDownloadFile: noop,
          }),
        );

        const viewer = screen.queryByTestId("inline-model-viewer");

        if (expectPreview) {
          expect(viewer).not.toBeNull();
        } else {
          expect(viewer).toBeNull();
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("does NOT render InlineModelViewer for user role even with preview files", () => {
    const filesWithPreview = fc
      .tuple(
        previewExtArb.chain((ext) => fileEntryArb(ext)),
        fc.array(nonPreviewExtArb.chain((ext) => fileEntryArb(ext)), { minLength: 0, maxLength: 2 }),
      )
      .map(([preview, rest]) => [preview, ...rest]);

    const userItemArb = segmentWithFilesArb(filesWithPreview).map((seg) => ({
      id: "item-user-test",
      role: "user" as const,
      rating: 0 as const,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      segments: [seg],
    }));

    fc.assert(
      fc.property(userItemArb, (item) => {
        const { unmount } = render(
          createElement(MessageBubble, {
            item,
            isSelected: false,
            busyAction: null,
            token: "test-token",
            onSelect: noop,
            onRate: noop,
            onRegenerate: noop,
            onDownloadFile: noop,
          }),
        );

        const viewer = screen.queryByTestId("inline-model-viewer");
        expect(viewer).toBeNull();

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
