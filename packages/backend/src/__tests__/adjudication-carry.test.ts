/** Carry (issue #102): identical items inherit a person's prior decision; anything else stays open. */
import { describe, it, expect } from "vitest";
import { matchCarried } from "../services/adjudication-carry.js";

const item = (o: Partial<{ exampleId: string; itemIndex: number; question: string; refState: string; candState: string }> = {}) =>
  ({ exampleId: "ex1", itemIndex: 2, question: "Is the lid present?", refState: "fail", candState: "pass", ...o });
const prior = (decision: string, o: Parameters<typeof item>[0] = {}) =>
  ({ ...item(o), decision, note: "seen it", decidedById: "u1", sittingTitle: "#85" });

describe("matchCarried", () => {
  it("carries a prior decision when example, position, question and both states match", () => {
    const m = matchCarried([item()], [prior("C")]);
    expect(m).toHaveLength(1);
    expect(m[0].from.decision).toBe("C");
  });
  it("ignores whitespace and case in the question", () => {
    expect(matchCarried([item({ question: "  is the LID present? " })], [prior("R")])).toHaveLength(1);
  });
  it("does not carry when the question or a state differs — the item is a different question, or the candidate sits on the other side", () => {
    expect(matchCarried([item({ question: "Is the base flat?" })], [prior("C")])).toHaveLength(0);
    expect(matchCarried([item({ candState: "fail", refState: "pass" })], [prior("C")])).toHaveLength(0);
    expect(matchCarried([item({ itemIndex: 3 })], [prior("C")])).toHaveLength(0);
  });
  it("takes the first prior decision offered per key (callers order newest first)", () => {
    const m = matchCarried([item()], [prior("R"), prior("C")]);
    expect(m[0].from.decision).toBe("R");
  });
});
