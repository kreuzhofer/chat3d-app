import type { ThinkingEffort } from "@chat3d/shared";

/**
 * The thinking-effort vocabulary, for the admin UI.
 *
 * The canonical list lives in `@chat3d/shared`, but the frontend Docker image
 * builds from the frontend package alone and does not include the shared
 * package, so a *runtime* import of it fails to resolve in Rollup (the existing
 * shared imports in this app are all `import type`, which is erased before
 * bundling). The values are therefore restated here, tied to the shared union
 * by the `satisfies` clause and the exhaustiveness check below: adding or
 * removing a member upstream breaks this file at compile time.
 */
export const THINKING_EFFORT_VALUES = ["off", "low", "medium", "high", "max"] as const satisfies readonly ThinkingEffort[];

/** Compile-time proof that no shared effort is missing from the list above. */
type MissingEfforts = Exclude<ThinkingEffort, (typeof THINKING_EFFORT_VALUES)[number]>;
const _allEffortsCovered: MissingEfforts extends never ? true : never = true;
void _allEffortsCovered;

export function thinkingEffortLabel(effort: ThinkingEffort): string {
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}
