/**
 * The suite's own database (issue #90): the name is resolved through one
 * guard, so a run can never target the app's database by omission.
 */
import { describe, it, expect } from "vitest";
import { resolveTestDatabaseName, DEFAULT_TEST_DB_NAME } from "../utils/test-database.js";

describe("resolveTestDatabaseName", () => {
  it("defaults to chat3d_test", () => {
    expect(resolveTestDatabaseName({})).toBe(DEFAULT_TEST_DB_NAME);
    expect(resolveTestDatabaseName({ DB_NAME: "chat3d" })).toBe("chat3d_test");
  });

  it("takes TEST_DB_NAME when it is a test database", () => {
    expect(resolveTestDatabaseName({ TEST_DB_NAME: "ci_test" })).toBe("ci_test");
  });

  it("refuses a name that is not *_test, and the app's own database whatever it is called", () => {
    expect(() => resolveTestDatabaseName({ TEST_DB_NAME: "chat3d" })).toThrow(/_test/);
    expect(() => resolveTestDatabaseName({ TEST_DB_NAME: "chat3d_prod" })).toThrow(/_test/);
    expect(() => resolveTestDatabaseName({ TEST_DB_NAME: "corpus_test", DB_NAME: "corpus_test" })).toThrow(/app's own database/);
  });

  it("is what this very suite is running against", () => {
    // vitest.setup.ts sets DB_NAME from the same function before any module loads.
    expect(process.env.DB_NAME).toBe(resolveTestDatabaseName({ TEST_DB_NAME: process.env.TEST_DB_NAME }));
    expect(process.env.DB_NAME).not.toBe("chat3d");
  });
});
