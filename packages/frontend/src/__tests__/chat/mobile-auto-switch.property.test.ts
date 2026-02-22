// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 24: Mobile auto-switch to workbench on new generation only

import { describe, expect, it } from "vitest";
import fc from "fast-check";

/* ---------- Pure decision function (mirrors ChatPage useEffect logic) ---------- */

/**
 * Determines whether the mobile pane should auto-switch to "workbench".
 *
 * This is a pure extraction of the decision logic from ChatPage's useEffect:
 * 1. First render (prevCount is null) → never switch (initializing ref)
 * 2. Count didn't increase → no switch (browsing history, no new generation)
 * 3. No preview-ready file (STL/3MF) → no switch
 * 4. Desktop viewport (>= 1280px) → no switch
 * 5. All conditions met → switch
 */
function shouldAutoSwitch(params: {
  prevCount: number | null;
  currentCount: number;
  hasPreviewFile: boolean;
  viewportWidth: number;
}): boolean {
  // First render (prevCount is null) → never switch
  if (params.prevCount === null) return false;
  // No new items → no switch
  if (params.currentCount <= params.prevCount) return false;
  // No preview file → no switch
  if (!params.hasPreviewFile) return false;
  // Desktop viewport → no switch
  if (params.viewportWidth >= 1280) return false;
  // All conditions met → switch
  return true;
}

/* ---------- Constants ---------- */

const DESKTOP_BREAKPOINT = 1280;

/* ---------- Property 24: Mobile auto-switch to workbench on new generation only ---------- */

// **Validates: Requirements 16.1, 16.2**
describe("Mobile auto-switch — Property 24: Mobile auto-switch to workbench on new generation only", () => {
  it("never auto-switches on first render (prevCount === null)", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 3840 }),
        (currentCount, hasPreviewFile, viewportWidth) => {
          const result = shouldAutoSwitch({
            prevCount: null,
            currentCount,
            hasPreviewFile,
            viewportWidth,
          });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never auto-switches when count does not increase", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        // offset ensures currentCount <= prevCount
        fc.nat({ max: 20 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 3840 }),
        (prevCount, offset, hasPreviewFile, viewportWidth) => {
          const currentCount = prevCount - offset; // currentCount <= prevCount
          const result = shouldAutoSwitch({
            prevCount,
            currentCount,
            hasPreviewFile,
            viewportWidth,
          });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never auto-switches when no preview files are present", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 3840 }),
        (prevCount, increment, viewportWidth) => {
          const result = shouldAutoSwitch({
            prevCount,
            currentCount: prevCount + increment,
            hasPreviewFile: false,
            viewportWidth,
          });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never auto-switches on desktop viewport (>= 1280px)", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: DESKTOP_BREAKPOINT, max: 7680 }),
        (prevCount, increment, viewportWidth) => {
          const result = shouldAutoSwitch({
            prevCount,
            currentCount: prevCount + increment,
            hasPreviewFile: true,
            viewportWidth,
          });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("always auto-switches when all conditions are met: new generation + preview file + mobile viewport", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: DESKTOP_BREAKPOINT - 1 }),
        (prevCount, increment, viewportWidth) => {
          const result = shouldAutoSwitch({
            prevCount,
            currentCount: prevCount + increment,
            hasPreviewFile: true,
            viewportWidth,
          });
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("auto-switch decision is a pure function of its inputs (deterministic)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.nat({ max: 50 }), { nil: null }),
        fc.nat({ max: 50 }),
        fc.boolean(),
        fc.integer({ min: 1, max: 3840 }),
        (prevCount, currentCount, hasPreviewFile, viewportWidth) => {
          const params = { prevCount, currentCount, hasPreviewFile, viewportWidth };
          const result1 = shouldAutoSwitch(params);
          const result2 = shouldAutoSwitch(params);
          expect(result1).toBe(result2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("boundary: viewport exactly at breakpoint (1280) does NOT auto-switch", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (prevCount, increment) => {
          const result = shouldAutoSwitch({
            prevCount,
            currentCount: prevCount + increment,
            hasPreviewFile: true,
            viewportWidth: DESKTOP_BREAKPOINT,
          });
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("boundary: viewport at 1279 (one below breakpoint) DOES auto-switch when conditions met", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        (prevCount, increment) => {
          const result = shouldAutoSwitch({
            prevCount,
            currentCount: prevCount + increment,
            hasPreviewFile: true,
            viewportWidth: DESKTOP_BREAKPOINT - 1,
          });
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
