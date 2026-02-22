// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 10: Download pills rendered for all file types in assistant responses

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import {
  DownloadPillGroup,
  type DownloadableFile,
} from "../../components/chat/DownloadPill";

/* ---------- Constants ---------- */

const RECOGNIZED_EXTENSIONS: Record<string, string> = {
  ".stl": "STL",
  ".step": "STEP",
  ".stp": "STEP",
  ".3mf": "3MF",
  ".b123d": "B123D",
};

const RECOGNIZED_EXT_LIST = Object.keys(RECOGNIZED_EXTENSIONS);

const UNRECOGNIZED_EXTENSIONS = [".txt", ".png", ".obj", ".pdf", ".zip", ".gcode", ".json", ".csv"];

/* ---------- Generators ---------- */

/** Generate a random filename stem (1–30 alphanumeric chars). */
const arbStem = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((s) => s.replace(/[^a-z0-9_-]/gi, "a"))
  .filter((s) => s.length > 0);

/** Generate a file with a recognized extension. */
const arbRecognizedFile: fc.Arbitrary<DownloadableFile> = fc
  .tuple(arbStem, fc.constantFrom(...RECOGNIZED_EXT_LIST))
  .map(([stem, ext]) => ({
    path: `modelcreator/${stem}${ext}`,
    filename: `${stem}${ext}`,
  }));

/** Generate a file with an unrecognized extension. */
const arbUnrecognizedFile: fc.Arbitrary<DownloadableFile> = fc
  .tuple(arbStem, fc.constantFrom(...UNRECOGNIZED_EXTENSIONS))
  .map(([stem, ext]) => ({
    path: `modelcreator/${stem}${ext}`,
    filename: `${stem}${ext}`,
  }));

/** Generate a mixed list of recognized and unrecognized files. */
const arbMixedFileList: fc.Arbitrary<DownloadableFile[]> = fc
  .tuple(
    fc.array(arbRecognizedFile, { minLength: 0, maxLength: 5 }),
    fc.array(arbUnrecognizedFile, { minLength: 0, maxLength: 5 }),
  )
  .map(([recognized, unrecognized]) =>
    [...recognized, ...unrecognized].sort(() => Math.random() - 0.5),
  );

/* ---------- Property 10: Download pills rendered for all file types ---------- */

// **Validates: Requirements 5.1, 5.3, 23.5**
describe("DownloadPillGroup — Property 10: Download pills rendered for all file types in assistant responses", () => {
  afterEach(cleanup);

  it("renders a pill with the correct format label for each recognized file", () => {
    fc.assert(
      fc.property(
        fc.array(arbRecognizedFile, { minLength: 1, maxLength: 8 }),
        (files) => {
          const onDownload = vi.fn();
          const { container, unmount } = render(
            createElement(DownloadPillGroup, { files, onDownload }),
          );

          const group = container.querySelector('[data-testid="download-pill-group"]');
          expect(group).not.toBeNull();

          // Each recognized file should produce a pill with the correct aria-label
          for (const file of files) {
            const ext = file.path.toLowerCase().slice(file.path.lastIndexOf("."));
            const expectedLabel = RECOGNIZED_EXTENSIONS[ext];
            const pill = container.querySelector(`[aria-label="Download ${expectedLabel}"]`);
            expect(pill).not.toBeNull();
          }

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns null (empty container) when no recognized files exist", () => {
    fc.assert(
      fc.property(
        fc.array(arbUnrecognizedFile, { minLength: 0, maxLength: 5 }),
        (files) => {
          const onDownload = vi.fn();
          const { container, unmount } = render(
            createElement(DownloadPillGroup, { files, onDownload }),
          );

          // No pill group should be rendered
          const group = container.querySelector('[data-testid="download-pill-group"]');
          expect(group).toBeNull();

          // No pills at all
          const pills = container.querySelectorAll("button");
          expect(pills.length).toBe(0);

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("does not render pills for unrecognized extensions in a mixed list", () => {
    fc.assert(
      fc.property(
        arbMixedFileList.filter((files) => files.length > 0),
        (files) => {
          const onDownload = vi.fn();
          const { container, unmount } = render(
            createElement(DownloadPillGroup, { files, onDownload }),
          );

          const buttons = container.querySelectorAll("button");

          // Count how many recognized files are in the input
          const recognizedCount = files.filter((f) => {
            const ext = f.path.toLowerCase().slice(f.path.lastIndexOf("."));
            return ext in RECOGNIZED_EXTENSIONS;
          }).length;

          // Number of pills should equal number of recognized files
          expect(buttons.length).toBe(recognizedCount);

          // Verify no pill has a label matching an unrecognized extension
          for (const ext of UNRECOGNIZED_EXTENSIONS) {
            const extUpper = ext.slice(1).toUpperCase();
            const pill = container.querySelector(`[aria-label="Download ${extUpper}"]`);
            expect(pill).toBeNull();
          }

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});
