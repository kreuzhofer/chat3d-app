import { describe, expect, it } from "vitest";
import type { AuthUser } from "../auth/types";
import { canAccessAuthenticatedRoute, canAccessRole } from "../auth/guards";

const activeUser: AuthUser = {
  id: "1",
  email: "user@example.test",
  role: "user",
  status: "active",
  displayName: "User",
};

describe("auth guards", () => {
  it("allows authenticated routes only for active users", () => {
    expect(canAccessAuthenticatedRoute(activeUser)).toBe(true);
    expect(canAccessAuthenticatedRoute(null)).toBe(false);
    expect(
      canAccessAuthenticatedRoute({
        ...activeUser,
        status: "deactivated",
      }),
    ).toBe(false);
  });

  it("enforces role checks", () => {
    expect(canAccessRole(activeUser, ["admin"])).toBe(false);
    expect(canAccessRole({ ...activeUser, role: "admin" }, ["admin"])).toBe(true);
  });
});
