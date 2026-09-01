/**
 * Runtime view of the shared `ThinkingEffort` union.
 *
 * The union itself belongs in `@chat3d/shared` — it crosses the admin API
 * boundary, so backend and frontend must agree on it. The *runtime* list
 * cannot come from there: neither container image ships `@chat3d/shared`,
 * because each Dockerfile builds from its own package directory. Type imports
 * survive that omission (they are erased before the code runs); value imports
 * do not, and crash the process on boot with ERR_MODULE_NOT_FOUND.
 *
 * So the type is imported and the values are restated here, with two checks
 * standing in for the single source of truth we cannot have at runtime:
 *
 *  - `satisfies` below rejects any entry that is not a valid ThinkingEffort;
 *  - the exhaustiveness alias fails to compile if shared gains a variant that
 *    this list is missing;
 *  - and shared-runtime-boundary.test.ts asserts the two lists are equal,
 *    catching a reordering that neither type-level check would see.
 */
import type { ThinkingEffort } from "@chat3d/shared";

export const THINKING_EFFORTS = [
  "off",
  "low",
  "medium",
  "high",
  "max",
] as const satisfies readonly ThinkingEffort[];

/**
 * Compile-time exhaustiveness. If `ThinkingEffort` gains a member that
 * THINKING_EFFORTS does not list, `Exclude<...>` stops being `never` and this
 * alias resolves to `false`, failing the constraint. Exported so it counts as
 * used.
 */
export type NoUnlistedThinkingEffort =
  Exclude<ThinkingEffort, (typeof THINKING_EFFORTS)[number]> extends never ? true : false;
const _assertExhaustive: NoUnlistedThinkingEffort = true;
void _assertExhaustive;

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === "string" && (THINKING_EFFORTS as readonly string[]).includes(value);
}
