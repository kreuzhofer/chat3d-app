// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 7, 8, 9: Progressive disclosure

import { cleanup, render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import { CollapsibleSection } from "../../components/chat/CollapsibleSection";

/* ---------- Generators ---------- */

/** Generate non-empty printable titles (avoids empty strings which aren't realistic section titles). */
const arbTitle = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

/* ---------- Property 7: Code and file sections collapsed by default ---------- */

// **Validates: Requirements 4.1, 23.4**
describe("CollapsibleSection — Property 7: Code and file sections collapsed by default", () => {
  afterEach(cleanup);

  it("content is hidden and aria-expanded is false when defaultExpanded is omitted or false", () => {
    fc.assert(
      fc.property(
        arbTitle,
        fc.constantFrom(undefined, false),
        (title, defaultExpanded) => {
          const marker = createElement("span", { "data-testid": "child" }, "content");
          const { container, unmount } = render(
            createElement(
              CollapsibleSection,
              { title, ...(defaultExpanded !== undefined ? { defaultExpanded } : {}) },
              marker,
            ),
          );

          // Content should NOT be visible
          expect(container.querySelector('[data-testid="child"]')).toBeNull();

          // Toggle button should have aria-expanded="false"
          const button = container.querySelector("button");
          expect(button).not.toBeNull();
          expect(button!.getAttribute("aria-expanded")).toBe("false");

          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });
});


/* ---------- Property 8: Expand/collapse round-trip restores original state ---------- */

// **Validates: Requirements 4.4**
describe("CollapsibleSection — Property 8: Expand/collapse round-trip restores original state", () => {
  afterEach(cleanup);

  it("expanding then collapsing restores the initial collapsed state", () => {
    fc.assert(
      fc.property(arbTitle, (title) => {
        // Use a stable data-testid marker so text matching isn't affected by special chars
        const marker = createElement("span", { "data-testid": "child" }, "content");
        const { container, unmount } = render(
          createElement(CollapsibleSection, { title }, marker),
        );

        const button = container.querySelector("button")!;
        const findChild = () => container.querySelector('[data-testid="child"]');

        // --- Initial state: collapsed ---
        expect(findChild()).toBeNull();
        expect(button.getAttribute("aria-expanded")).toBe("false");

        // --- Expand ---
        fireEvent.click(button);
        expect(findChild()).not.toBeNull();
        expect(button.getAttribute("aria-expanded")).toBe("true");

        // --- Collapse (round-trip) ---
        fireEvent.click(button);
        expect(findChild()).toBeNull();
        expect(button.getAttribute("aria-expanded")).toBe("false");

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});

/* ---------- Property 9: Collapsible controls have accessible labels and keyboard support ---------- */

// **Validates: Requirements 4.5**
describe("CollapsibleSection — Property 9: Collapsible controls have accessible labels and keyboard support", () => {
  afterEach(cleanup);

  it("toggle button has a non-empty aria-label and aria-expanded attribute", () => {
    fc.assert(
      fc.property(arbTitle, (title) => {
        const { container, unmount } = render(
          createElement(CollapsibleSection, { title }, "content"),
        );

        const button = container.querySelector("button")!;

        // aria-expanded must be present
        const ariaExpanded = button.getAttribute("aria-expanded");
        expect(ariaExpanded).not.toBeNull();
        expect(["true", "false"]).toContain(ariaExpanded);

        // aria-label must be non-empty
        const ariaLabel = button.getAttribute("aria-label");
        expect(ariaLabel).not.toBeNull();
        expect(ariaLabel!.trim().length).toBeGreaterThan(0);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("toggle is a native button element (inherits keyboard Enter/Space activation)", () => {
    fc.assert(
      fc.property(arbTitle, (title) => {
        const { container, unmount } = render(
          createElement(CollapsibleSection, { title }, "content"),
        );

        const button = container.querySelector("button");

        // Must be a real <button> element — native buttons receive
        // keyboard activation (Enter and Space fire click) from the browser.
        expect(button).not.toBeNull();
        expect(button!.tagName).toBe("BUTTON");

        // Must have type="button" to prevent accidental form submission
        expect(button!.getAttribute("type")).toBe("button");

        // Must be focusable (not disabled, no negative tabindex)
        expect(button!.hasAttribute("disabled")).toBe(false);
        const tabIndex = button!.getAttribute("tabindex");
        expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
