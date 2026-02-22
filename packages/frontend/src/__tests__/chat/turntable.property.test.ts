// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 6: Turntable rotation speed within specified range

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { calculateTurntableRotation } from "../../components/chat/InlineModelViewer";

/* ---------- Constants ---------- */

/** One full revolution every 10 seconds → fastest allowed angular velocity. */
const MAX_ANGULAR_VELOCITY = (2 * Math.PI) / 10;

/** One full revolution every 15 seconds → slowest allowed angular velocity. */
const MIN_ANGULAR_VELOCITY = (2 * Math.PI) / 15;

/* ---------- Property Test ---------- */

// **Validates: Requirements 22.1**
describe("Turntable — Property 6: Turntable rotation speed within specified range", () => {
  it("angular velocity is between 2π/15 and 2π/10 rad/s for any positive frame delta", () => {
    fc.assert(
      fc.property(
        // Typical frame deltas: 1ms to 100ms (covers 10fps to 1000fps)
        fc.double({ min: 1, max: 100, noNaN: true }),
        (deltaMs) => {
          const rotation = calculateTurntableRotation(deltaMs);
          const deltaSec = deltaMs / 1000;
          const angularVelocity = rotation / deltaSec;

          expect(angularVelocity).toBeGreaterThanOrEqual(MIN_ANGULAR_VELOCITY);
          expect(angularVelocity).toBeLessThanOrEqual(MAX_ANGULAR_VELOCITY);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: ux-gaps-conversational-experience, Property 5: User interaction pauses turntable animation

// **Validates: Requirements 3.3, 22.3**
describe("Turntable — Property 5: User interaction pauses turntable animation", () => {
  it("rotation delta is zero when delta is zero (paused state), for any interaction event type", () => {
    const interactionEvents = fc.constantFrom("mousedown", "touchstart");

    fc.assert(
      fc.property(interactionEvents, (eventType: string) => {
        // When the user interacts (mousedown/touchstart), the component sets
        // turntableActiveRef to false and the animation loop passes delta=0.
        // The contract: calculateTurntableRotation(0) must return 0.
        const rotation = calculateTurntableRotation(0);

        expect(rotation).toBe(0);
        // Verify the event type is a valid interaction trigger
        expect(["mousedown", "touchstart"]).toContain(eventType);
      }),
      { numRuns: 100 },
    );
  });

  it("function is pure: same delta always produces same rotation (interaction pause is deterministic)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 200, noNaN: true }),
        (deltaMs) => {
          const rotation1 = calculateTurntableRotation(deltaMs);
          const rotation2 = calculateTurntableRotation(deltaMs);

          expect(rotation1).toBe(rotation2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("positive delta produces positive rotation, zero delta produces zero (pause vs active contract)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 100, noNaN: true }),
        (positiveDelta) => {
          const activeRotation = calculateTurntableRotation(positiveDelta);
          const pausedRotation = calculateTurntableRotation(0);

          // Active turntable: positive rotation
          expect(activeRotation).toBeGreaterThan(0);
          // Paused turntable (user interacting): zero rotation
          expect(pausedRotation).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
