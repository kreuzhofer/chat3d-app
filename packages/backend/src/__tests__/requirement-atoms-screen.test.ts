/** #113: the wrong-question classes Daniel's sittings measured, screened out of visual atoms. */
import { describe, it, expect } from "vitest";
import { screenAtoms } from "../services/requirement-atoms.js";

const v = (text: string) => ({ text, visibility: "visual" as const });

describe("screenAtoms", () => {
  it("drops orientation words the request does not use, keeps them when it does", () => {
    const r = screenAtoms([v("Circular through-hole on the front face"), v("Open top with no lid")], "A switch housing cylinder with a push button hole, open top");
    expect(r.dropped).toMatchObject([{ reason: "orientation-not-in-request", word: "front" }]);
    expect(r.kept.map((a) => a.text)).toEqual(["Open top with no lid"]);
  });
  it("drops pose-on-plate questions the request does not ask for", () => {
    const r = screenAtoms([v("The lid is placed upside down"), v("Cylinder base on the XY plane")], "A case with a separate lid");
    expect(r.dropped.map((d) => d.reason)).toEqual(["orientation-not-in-request", "orientation-not-in-request"]);
  });
  it("drops colour checks", () => {
    expect(screenAtoms([v("Looks like a translucent blue enclosure")], "a translucent blue case").dropped[0].reason).toBe("colour");
  });
  it("routes comparisons and fine features to code", () => {
    const r = screenAtoms([v("Long walls are thicker than short walls"), v("Bottom inner edge has a chamfer"), v("Exactly four standoffs")], "a block, chamfer the bottom inner edge");
    expect(r.routed.map((a) => a.text)).toEqual(["Long walls are thicker than short walls", "Bottom inner edge has a chamfer"]);
    expect(r.kept.find((a) => a.text === "Exactly four standoffs")?.visibility).toBe("visual");
  });
  it("leaves code atoms and screening without a request text alone for orientation", () => {
    const r = screenAtoms([{ text: "Front wall is 2mm", visibility: "code" }, v("Hole on the front face")]);
    expect(r.dropped).toEqual([]);
    expect(r.kept).toHaveLength(2);
  });
});
