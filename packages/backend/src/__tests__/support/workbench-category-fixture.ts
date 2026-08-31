/**
 * Teardown helper for tests that create their own workbench category.
 *
 * Several integration tests seed a throwaway category (`backfill-test-<ts>-<n>`
 * and friends) and never removed it, so the table accumulated 306 test
 * categories against 16 real ones — enough to swamp any query that reads
 * workbench_categories without filtering.
 *
 * Safety: the delete is keyed on the primary key captured from the create call.
 * There is no name or pattern matching anywhere in here, so it cannot match a
 * category the test did not create. The `id` guard is not cosmetic — Prisma
 * treats `deleteMany({ where: { id: undefined } })` as an unfiltered delete,
 * which would wipe every category in the database, so a falsy id must never
 * reach the query.
 */
import { prisma } from "../../db/prisma.js";

export async function deleteTestCategory(id: string | undefined | null): Promise<void> {
  if (typeof id !== "string" || id.trim() === "") return;
  // Cascades to prompts -> examples -> traces/rag events via FK ON DELETE CASCADE.
  // deleteMany (not delete) so a test that already removed it is not an error.
  await prisma.workbenchCategory.deleteMany({ where: { id } });
}
