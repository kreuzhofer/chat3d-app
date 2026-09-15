/**
 * The test suite's own database (issue #90).
 *
 * `npm test` used to migrate and run against whatever `DB_NAME` resolved
 * to — the app's `chat3d` by default — and a run that did not finish its
 * cleanup left fixture rows counted as production. The suite now selects a
 * database of its own, on the same Postgres, and refuses to run against
 * anything that is not clearly a test database. Pure: reads nothing but
 * the environment it is handed.
 */

export const DEFAULT_TEST_DB_NAME = "chat3d_test";

/**
 * The name the suite runs against: `TEST_DB_NAME`, else `chat3d_test`. It
 * must end in `_test` and must not be the app's own database (`DB_NAME`,
 * `chat3d` by default), whatever the caller set — a guard on the name is
 * the one thing that cannot be forgotten by a test.
 */
export function resolveTestDatabaseName(env: Record<string, string | undefined>): string {
  const name = env.TEST_DB_NAME?.trim() || DEFAULT_TEST_DB_NAME;
  const app = env.DB_NAME?.trim() || "chat3d";
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${name}": a test database is named *_test`);
  }
  if (name === app) {
    throw new Error(`Refusing to run tests against "${name}": it is the app's own database (DB_NAME)`);
  }
  return name;
}
