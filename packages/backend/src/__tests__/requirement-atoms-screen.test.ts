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
    const r = screenAtoms([v("Long walls are thicker than short walls"), v("Bottom inner edge has a chamfer"), v("Exactly four standoffs")], "a block");
    expect(r.routed.map((a) => a.text)).toEqual(["Long walls are thicker than short walls", "Bottom inner edge has a chamfer"]);
    expect(r.kept.find((a) => a.text === "Exactly four standoffs")?.visibility).toBe("visual");
  });
  it("leaves code atoms and screening without a request text alone for orientation", () => {
    const r = screenAtoms([{ text: "Front wall is 2mm", visibility: "code" }, v("Hole on the front face")]);
    expect(r.dropped).toEqual([]);
    expect(r.kept).toHaveLength(2);
  });
});

describe("screenAtoms under the Orientation declaration (#138)", () => {
  const c = (text: string) => ({ text, visibility: "code" as const });
  const noFront = { up: "the flat top face", front: null };
  const front = { up: "the open top", front: "the USB-C port" };

  it("drops front/back/left/right from every atom when the declaration says no front — code atoms too", () => {
    const r = screenAtoms(
      [v("Hole on the front face"), c("Left wall is 2mm"), v("Rear edge is rounded"), v("Four holes near the corners")],
      "a washer plate, holes on the front face, left wall 2mm, rounded rear edge",
      noFront,
    );
    expect(r.dropped.map((d) => [d.reason, d.word])).toEqual([["no-front", "front"], ["no-front", "left"], ["no-front", "rear"]]);
    expect(r.kept.map((a) => a.text)).toEqual(["Four holes near the corners"]);
  });

  it("never reads \"right angle\" as a side", () => {
    const atoms = [v("The bracket is bent at a right angle"), v("Two right-angled plates")];
    expect(screenAtoms(atoms, "an L bracket", noFront)).toMatchObject({ dropped: [], routed: [] });
    expect(screenAtoms(atoms, "an L bracket with a hole on the front", front)).toMatchObject({ dropped: [], routed: [] });
  });

  it("keeps top/bottom under no front", () => {
    const r = screenAtoms([v("The top face is flat")], "a plain plate", noFront);
    expect(r.dropped).toEqual([]);
  });

  it("routes a direction the request itself states to code, for the reviewer", () => {
    const r = screenAtoms([v("The USB-C opening is on the front face"), v("Exactly four standoffs")], "a case with a USB-C opening on the front", front);
    expect(r.routed.map((a) => a.text)).toEqual(["The USB-C opening is on the front face"]);
    expect(r.kept.map((a) => a.visibility)).toEqual(["code", "visual"]);
  });

  it("still drops a direction the request does not use, under a declared front", () => {
    const r = screenAtoms([v("The vents are on the left side")], "a case with a USB-C opening on the front", front);
    expect(r.dropped).toMatchObject([{ reason: "orientation-not-in-request", word: "left" }]);
  });

  it("does not route top/bottom: the judge reads them off the renders", () => {
    const r = screenAtoms([v("The bottom face is flat")], "a box with a flat bottom", front);
    expect(r.routed).toEqual([]);
    expect(r.kept[0].visibility).toBe("visual");
  });
});

describe("screenAtoms keeps top/bottom", () => {
  it("does not drop top/bottom — the render's up axis is the part's", () => {
    const r = screenAtoms([v("The top and bottom faces of the tube are flat annular rings")], "a tube 20mm outer diameter");
    expect(r.dropped).toEqual([]);
  });
});
