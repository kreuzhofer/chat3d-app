// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 21, 22: Camera controls

import { cleanup, render, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import {
  CameraControlsToolbar,
  type CameraControlsToolbarProps,
} from "../../components/chat/CameraControlsToolbar";

/* ---------- Helpers ---------- */

function renderToolbar(isFullscreen: boolean) {
  const callbacks = {
    onResetView: vi.fn(),
    onZoomToFit: vi.fn(),
    onToggleFullscreen: vi.fn(),
  };
  const result = render(
    createElement(CameraControlsToolbar, {
      ...callbacks,
      isFullscreen,
    } satisfies CameraControlsToolbarProps),
  );
  return { ...result, callbacks };
}

/* ---------- Property 21: Camera controls toolbar visible when model is loaded ---------- */

// **Validates: Requirements 14.1, 14.4**
describe("CameraControlsToolbar — Property 21: Camera controls toolbar visible when model is loaded", () => {
  afterEach(cleanup);

  it("toolbar is always rendered with all three buttons for any isFullscreen state", () => {
    fc.assert(
      fc.property(fc.boolean(), (isFullscreen) => {
        const { container, unmount } = renderToolbar(isFullscreen);

        // Toolbar element must exist
        const toolbar = container.querySelector(
          '[data-testid="camera-controls-toolbar"]',
        );
        expect(toolbar).not.toBeNull();

        // Toolbar must have role="toolbar"
        expect(toolbar!.getAttribute("role")).toBe("toolbar");

        // Must contain exactly three buttons
        const buttons = toolbar!.querySelectorAll("button");
        expect(buttons.length).toBe(3);

        // Verify each expected button is present via aria-label
        const labels = Array.from(buttons).map((b) =>
          b.getAttribute("aria-label"),
        );
        expect(labels).toContain("Reset View");
        expect(labels).toContain("Zoom to Fit");

        // Fullscreen button label depends on state
        const expectedFsLabel = isFullscreen
          ? "Exit Fullscreen"
          : "Fullscreen";
        expect(labels).toContain(expectedFsLabel);

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});


/* ---------- Property 22: Camera controls have accessible labels and keyboard support ---------- */

// **Validates: Requirements 14.1, 14.4**
describe("CameraControlsToolbar — Property 22: Camera controls have accessible labels and keyboard support", () => {
  afterEach(cleanup);

  it("every button has a non-empty aria-label", () => {
    fc.assert(
      fc.property(fc.boolean(), (isFullscreen) => {
        const { container, unmount } = renderToolbar(isFullscreen);

        const buttons = container.querySelectorAll(
          '[data-testid="camera-controls-toolbar"] button',
        );

        for (const button of Array.from(buttons)) {
          const ariaLabel = button.getAttribute("aria-label");
          expect(ariaLabel).not.toBeNull();
          expect(ariaLabel!.trim().length).toBeGreaterThan(0);
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("buttons are native <button> elements (inherits keyboard Enter/Space activation)", () => {
    fc.assert(
      fc.property(fc.boolean(), (isFullscreen) => {
        const { container, unmount } = renderToolbar(isFullscreen);

        const buttons = container.querySelectorAll(
          '[data-testid="camera-controls-toolbar"] button',
        );

        for (const button of Array.from(buttons)) {
          // Must be a real <button> — native buttons receive keyboard
          // activation (Enter and Space fire click) from the browser.
          expect(button.tagName).toBe("BUTTON");

          // Must have type="button" to prevent accidental form submission
          expect(button.getAttribute("type")).toBe("button");

          // Must be focusable (not disabled, no negative tabindex)
          expect(button.hasAttribute("disabled")).toBe(false);
          const tabIndex = button.getAttribute("tabindex");
          expect(tabIndex === null || Number(tabIndex) >= 0).toBe(true);
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("clicking each button calls the corresponding callback", () => {
    fc.assert(
      fc.property(fc.boolean(), (isFullscreen) => {
        const { container, callbacks, unmount } = renderToolbar(isFullscreen);

        const toolbar = container.querySelector(
          '[data-testid="camera-controls-toolbar"]',
        )!;
        const buttons = toolbar.querySelectorAll("button");

        // Find buttons by aria-label and click them
        for (const button of Array.from(buttons)) {
          const label = button.getAttribute("aria-label");
          if (label === "Reset View") {
            fireEvent.click(button);
          } else if (label === "Zoom to Fit") {
            fireEvent.click(button);
          } else {
            // Fullscreen / Exit Fullscreen
            fireEvent.click(button);
          }
        }

        expect(callbacks.onResetView).toHaveBeenCalledTimes(1);
        expect(callbacks.onZoomToFit).toHaveBeenCalledTimes(1);
        expect(callbacks.onToggleFullscreen).toHaveBeenCalledTimes(1);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("fullscreen button label changes based on isFullscreen prop", () => {
    fc.assert(
      fc.property(fc.boolean(), (isFullscreen) => {
        const { container, unmount } = renderToolbar(isFullscreen);

        const toolbar = container.querySelector(
          '[data-testid="camera-controls-toolbar"]',
        )!;
        const buttons = Array.from(toolbar.querySelectorAll("button"));

        const fsButton = buttons.find((b) => {
          const label = b.getAttribute("aria-label");
          return label === "Fullscreen" || label === "Exit Fullscreen";
        });

        expect(fsButton).not.toBeUndefined();

        if (isFullscreen) {
          expect(fsButton!.getAttribute("aria-label")).toBe("Exit Fullscreen");
          expect(fsButton!.textContent).toContain("Exit Fullscreen");
        } else {
          expect(fsButton!.getAttribute("aria-label")).toBe("Fullscreen");
          expect(fsButton!.textContent).toContain("Fullscreen");
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
