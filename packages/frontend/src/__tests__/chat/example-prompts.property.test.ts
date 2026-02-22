// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 11: Clicking example prompt populates composer

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createElement } from "react";
import { ExamplePrompts } from "../../components/chat/ExamplePrompts";

/* ---------- Constants ---------- */

/**
 * The actual example prompts defined in ExamplePrompts.tsx.
 * We use fc.constantFrom to select from these, ensuring the property test
 * exercises real prompt data rather than synthetic strings.
 */
const EXAMPLE_PROMPT_TEXTS = [
  "Design a spur gear with 20 teeth, a module of 2mm, and a 5mm center bore.",
  "Create a simple snap-fit enclosure for a Raspberry Pi 4, with ventilation slots and mounting holes.",
  "Generate an L-shaped mounting bracket, 50mm × 30mm with 3mm thickness and four M4 bolt holes.",
  "Design a stepped hose adapter that transitions from 12mm inner diameter to 8mm, 40mm long with barbed ridges.",
];

/* ---------- Generators ---------- */

/** Pick a random example prompt from the actual set. */
const arbExamplePrompt = fc.constantFrom(...EXAMPLE_PROMPT_TEXTS);

/* ---------- Property 11: Clicking example prompt populates composer ---------- */

// **Validates: Requirements 6.2**
describe("ExamplePrompts — Property 11: Clicking example prompt populates composer", () => {
  afterEach(cleanup);

  it("calls onSelectPrompt with the exact prompt text when any example is clicked", () => {
    fc.assert(
      fc.property(arbExamplePrompt, (promptText) => {
        const onSelectPrompt = vi.fn();
        const { container, unmount } = render(
          createElement(ExamplePrompts, { onSelectPrompt }),
        );

        // Find the button whose text content includes the prompt text
        const buttons = container.querySelectorAll('button[role="listitem"]');
        let targetButton: Element | null = null;
        for (const btn of buttons) {
          if (btn.textContent?.includes(promptText)) {
            targetButton = btn;
            break;
          }
        }

        expect(targetButton).not.toBeNull();
        fireEvent.click(targetButton!);

        // The callback should have been called exactly once with the exact prompt text
        expect(onSelectPrompt).toHaveBeenCalledTimes(1);
        expect(onSelectPrompt).toHaveBeenCalledWith(promptText);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it("renders all example prompts as clickable elements", () => {
    const onSelectPrompt = vi.fn();
    const { container } = render(
      createElement(ExamplePrompts, { onSelectPrompt }),
    );

    const buttons = container.querySelectorAll('button[role="listitem"]');
    expect(buttons.length).toBe(EXAMPLE_PROMPT_TEXTS.length);

    // Each prompt text should appear in exactly one button
    for (const promptText of EXAMPLE_PROMPT_TEXTS) {
      const matching = Array.from(buttons).filter((btn) =>
        btn.textContent?.includes(promptText),
      );
      expect(matching.length).toBe(1);
    }
  });
});
