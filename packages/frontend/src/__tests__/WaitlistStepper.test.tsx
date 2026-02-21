// @vitest-environment jsdom
// Feature: 001-design-debt-resolution, Property 3: WaitlistStepper step state mapping

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { render } from "@testing-library/react";
import { mapStepStates, WaitlistStepper, type WaitlistStepperStatus } from "../components/WaitlistStepper";

/* ---------- Expected mapping table ---------- */

const expectedMapping: Record<WaitlistStepperStatus, [string, string, string]> = {
  not_joined: ["active", "upcoming", "upcoming"],
  pending_confirmation: ["completed", "active", "upcoming"],
  pending_approval: ["completed", "completed", "active"],
  approved: ["completed", "completed", "completed"],
  rejected: ["completed", "completed", "rejected"],
};

/* ---------- Generator ---------- */

const statusArb: fc.Arbitrary<WaitlistStepperStatus> = fc.constantFrom(
  "not_joined",
  "pending_confirmation",
  "pending_approval",
  "approved",
  "rejected",
);

/* ---------- Property Test ---------- */

// **Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8**
describe("WaitlistStepper — Property 3: step state mapping", () => {
  it("mapStepStates produces the correct [step1, step2, step3] tuple for every status", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const result = mapStepStates(status);
        const expected = expectedMapping[status];

        expect(result).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});

// Feature: 001-design-debt-resolution, Property 4: WaitlistStepper structure and accessibility

/* ---------- Active step expectations ---------- */

/** Maps each status to the index of the active step, or null when no step is active. */
const activeStepIndex: Record<WaitlistStepperStatus, number | null> = {
  not_joined: 0, // "Join" is active
  pending_confirmation: 1, // "Confirm Email" is active
  pending_approval: 2, // "Approved" is active
  approved: null, // all completed
  rejected: null, // all completed/rejected
};

/* ---------- Property Test ---------- */

// **Validates: Requirements 3.1, 3.11**
describe("WaitlistStepper — Property 4: structure and accessibility", () => {
  it("renders exactly three steps labeled Join, Confirm Email, Approved with correct ARIA attributes", () => {
    fc.assert(
      fc.property(statusArb, (status) => {
        const { container, unmount } = render(<WaitlistStepper status={status} />);

        // Container has role="group" and aria-label="Waitlist progress"
        const group = container.querySelector('[role="group"]');
        expect(group).not.toBeNull();
        expect(group!.getAttribute("aria-label")).toBe("Waitlist progress");

        // Exactly three steps with the expected labels
        const stepLabels = ["Join", "Confirm Email", "Approved"];
        for (const label of stepLabels) {
          const stepEl = group!.querySelector(`[aria-label^="${label},"]`);
          expect(stepEl).not.toBeNull();
        }

        // Count step elements (those with aria-label matching "<label>, <state>")
        const stepElements = group!.querySelectorAll(
          '[aria-label^="Join,"], [aria-label^="Confirm Email,"], [aria-label^="Approved,"]',
        );
        expect(stepElements.length).toBe(3);

        // Active step has aria-current="step"; non-active steps do not
        const expectedActive = activeStepIndex[status];
        for (let i = 0; i < stepLabels.length; i++) {
          const stepEl = group!.querySelector(`[aria-label^="${stepLabels[i]},"]`);
          if (i === expectedActive) {
            expect(stepEl!.getAttribute("aria-current")).toBe("step");
          } else {
            expect(stepEl!.getAttribute("aria-current")).toBeNull();
          }
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
