/**
 * The Orientation declaration and the Model frame (ADR 0007, issue #138).
 *
 * Every model is built in one Model frame — Z up as the object is used, front
 * facing −Y, right facing +X — and every spec declares how its object sits in
 * it: what is up, and which feature faces front, or "no front". Codegen builds
 * to it, the code reviewer checks prompt-stated directions against it, and
 * the screen drops front/back/left/right when there is no front.
 *
 * The generator's reply is read strictly: a missing or malformed declaration
 * is refused like a missing body count (#136), never defaulted — a default
 * front is exactly the invented front the ADR forbids. Pure.
 */

// A type, not an interface: it is stored as JSON, and only a type alias is
// assignable to Prisma's JSON input.
export type OrientationDeclaration = {
  /** What is up as the object is used ("the open top", "the display face"). */
  up: string;
  /** The feature facing front (−Y); null = the object has no front. */
  front: string | null;
};

/** The frame in one sentence, shared by every prompt that states it. */
export const MODEL_FRAME = "Z up as the object is used (not as it is printed), front facing −Y, right facing +X (left and right as seen facing the front)";

/** The declaration rule; spec generation only (enrichment keeps the spec's declaration). */
export const ORIENTATION_DECLARATION_RULE = `"orientation" places the object in the Model frame — ${MODEL_FRAME} — as {"up": ..., "front": ...}. Never omit it.
   - "up": what is up when the object is in use, in a few words ("the open top", "the lid", "the display face").
   - "front": the feature that faces front (−Y). When the request says what is at the front, that is the front. When it is silent, choose by rule: the face with the features the user interacts with (ports, buttons, a display, an opening, a label); otherwise the face a feature points out of (a spout, a hook's opening); otherwise "none". Never invent a front: a sphere, a washer or a plain plate is "none".
   - With "front": "none", no criterion may use front, back, left or right.`;

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** The generator's declaration, or null when it is missing or malformed. "none" (any case) = no front. */
export function parseOrientationDeclaration(raw: unknown): OrientationDeclaration | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const up = nonEmpty((raw as { up?: unknown }).up);
  const front = nonEmpty((raw as { front?: unknown }).front);
  if (!up || !front) return null;
  return { up, front: front.toLowerCase() === "none" ? null : front };
}

/** A stored declaration (front null = no front), or null for a row written before #138 or a damaged one. */
export function toOrientationDeclaration(stored: unknown): OrientationDeclaration | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
  const up = nonEmpty((stored as { up?: unknown }).up);
  const rawFront = (stored as { front?: unknown }).front;
  if (!up) return null;
  if (rawFront === null) return { up, front: null };
  const front = nonEmpty(rawFront);
  return front ? { up, front } : null;
}

/** The declaration in one line, as codegen, the reviewer and reports show it. */
export function describeDeclaration(d: OrientationDeclaration): string {
  return d.front
    ? `up is ${d.up}; the front (the −Y face) is ${d.front}.`
    : `up is ${d.up}; this object has no front, so front, back, left and right have no meaning for it.`;
}

/**
 * The Model frame, and the prompt's declaration when it has one, as a prompt
 * section for codegen and the code reviewer.
 */
export function modelFrameSection(declaration: OrientationDeclaration | null | undefined): string {
  const lines = [
    "## Model frame",
    "",
    `Every model is built in one frame: ${MODEL_FRAME}. The renders look at it from these sides: the front view looks at the −Y face, the top view at +Z. Build the object in this frame — never in print orientation, never turned to suit a view.`,
    "A side named in the request maps onto the frame: front = −Y, back = +Y, right = +X, left = −X, top = +Z, bottom = −Z.",
  ];
  if (declaration) lines.push("", `Orientation declaration for this request: ${describeDeclaration(declaration)}`);
  return lines.join("\n");
}
