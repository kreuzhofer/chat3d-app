/**
 * The judge's answer shapes (issue #66).
 *
 * On vLLM the schema IS the decoding grammar, so its key order is the order
 * the judge writes in. The parts-inventory shape exists to put the inventory
 * before the checklist; a test that only checked the keys were present would
 * miss the entire mechanism.
 */
import { describe, it, expect } from "vitest";
import { buildEvaluationResponseSchema } from "../services/visual-eval-schema.service.js";

const keys = (schema: ReturnType<typeof buildEvaluationResponseSchema>) =>
  Object.keys(schema.properties as Record<string, unknown>);

describe("buildEvaluationResponseSchema", () => {
  it("is unchanged for production — the shipped instrument id must not move", () => {
    expect(keys(buildEvaluationResponseSchema(3))).toEqual(["score", "issues", "suggestions", "checklist"]);
    expect(buildEvaluationResponseSchema(3).required).toEqual(["score", "issues", "suggestions", "checklist"]);
    expect(JSON.stringify(buildEvaluationResponseSchema(3, "production"))).toBe(
      JSON.stringify(buildEvaluationResponseSchema(3)),
    );
  });

  it("evidence-first orders each item question → detail → pass, so the judge writes its evidence before it commits (issue #60)", () => {
    const schema = buildEvaluationResponseSchema(3, "evidence-first");
    expect(keys(schema)).toEqual(["score", "issues", "suggestions", "checklist"]);
    const item = (schema.properties!.checklist as { items: { properties: Record<string, unknown>; required: string[] } }).items;
    expect(Object.keys(item.properties)).toEqual(["question", "detail", "pass"]);
    expect(item.required).toEqual(["question", "detail", "pass"]);
    // the item's answer set is unchanged: true, false, uncertain
    expect((item.properties.pass as { enum: unknown[] }).enum).toEqual([true, false, null]);
    // production keeps pass before detail
    const prod = (buildEvaluationResponseSchema(3).properties!.checklist as { items: { properties: Record<string, unknown> } }).items;
    expect(Object.keys(prod.properties)).toEqual(["question", "pass", "detail"]);
  });

  it("writes the inventory before the checklist, in properties and in required", () => {
    const schema = buildEvaluationResponseSchema(3, "inventory");
    expect(keys(schema)).toEqual(["inventory", "score", "issues", "suggestions", "checklist"]);
    expect(schema.required).toEqual(["inventory", "score", "issues", "suggestions", "checklist"]);
  });

  it("asks the inventory for a count that can be checked and three sentences of evidence", () => {
    const inventory = (buildEvaluationResponseSchema(1, "inventory").properties as Record<string, any>).inventory;
    expect(Object.keys(inventory.properties)).toEqual(["bodyCount", "bodies", "partsNamed", "openings"]);
    expect(inventory.properties.bodyCount.type).toBe("integer");
    expect(inventory.additionalProperties).toBe(false);
    expect(inventory.required).toEqual(["bodyCount", "bodies", "partsNamed", "openings"]);
  });

  it("keeps the inventory when no checklist is asked — the shape is the instrument's, not the specimen's", () => {
    const schema = buildEvaluationResponseSchema(0, "inventory");
    expect(keys(schema)).toEqual(["inventory", "score", "issues", "suggestions"]);
  });
});
