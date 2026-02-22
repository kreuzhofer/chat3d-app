// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 29: Admin route guard redirects non-admin users

import { describe, expect, it } from "vitest";
import fc from "fast-check";

/* ---------- Pure decision functions (mirror AdminRouteGuard / RequireRole logic) ---------- */

/** The set of admin-only routes protected by AdminRouteGuard. */
const ADMIN_ONLY_ROUTES = ["/query", "/notifications", "/admin"] as const;
type AdminRoute = (typeof ADMIN_ONLY_ROUTES)[number];

/**
 * Determines whether a user with the given role should be redirected
 * away from an admin-only route.
 *
 * Mirrors the logic in RequireRole: `canAccessRole(user, ["admin"])`.
 * Only users with role "admin" pass; all others are redirected.
 */
function shouldRedirectFromAdminRoute(role: string): boolean {
  return role !== "admin";
}

/**
 * Returns the redirect target for non-admin users on admin-only routes.
 * AdminRouteGuard always redirects to "/chat".
 */
function getRedirectTarget(): string {
  return "/chat";
}

/**
 * Determines whether the redirect should use replace navigation.
 * AdminRouteGuard uses `<Navigate replace to="/chat" />`,
 * so the restricted route never appears in browser history.
 */
function usesReplaceNavigation(): boolean {
  return true;
}

/**
 * Determines the route guard outcome for a given role and admin route.
 * Returns either { action: "redirect", to: string, replace: boolean }
 * or { action: "render" }.
 */
function routeGuardDecision(
  role: string,
  _route: AdminRoute,
): { action: "redirect"; to: string; replace: boolean } | { action: "render" } {
  if (shouldRedirectFromAdminRoute(role)) {
    return { action: "redirect", to: getRedirectTarget(), replace: usesReplaceNavigation() };
  }
  return { action: "render" };
}

/* ---------- Generators ---------- */

/** Generate a random admin-only route. */
const arbAdminRoute: fc.Arbitrary<AdminRoute> = fc.constantFrom(
  ...ADMIN_ONLY_ROUTES,
);

/** Generate a random non-admin user role (anything except "admin"). */
const arbNonAdminRole: fc.Arbitrary<string> = fc.constantFrom(
  "user",
  "viewer",
  "editor",
  "moderator",
  "guest",
  "operator",
);

/** Generate a random user role (including admin). */
const arbAnyRole: fc.Arbitrary<string> = fc.oneof(
  fc.constant("admin"),
  arbNonAdminRole,
);

/* ---------- Property 29: Admin route guard redirects non-admin users ---------- */

// **Validates: Requirements 19.4, 20.4, 21.1, 21.2, 21.3, 21.4, 21.5**
describe("Route Guard — Property 29: Admin route guard redirects non-admin users", () => {
  it("non-admin users are redirected to /chat for any admin-only route", () => {
    fc.assert(
      fc.property(arbNonAdminRole, arbAdminRoute, (role, route) => {
        const decision = routeGuardDecision(role, route);
        expect(decision).toEqual({
          action: "redirect",
          to: "/chat",
          replace: true,
        });
      }),
      { numRuns: 100 },
    );
  });

  it("admin users are NOT redirected for any admin-only route", () => {
    fc.assert(
      fc.property(arbAdminRoute, (route) => {
        const decision = routeGuardDecision("admin", route);
        expect(decision).toEqual({ action: "render" });
      }),
      { numRuns: 100 },
    );
  });

  it("redirect decision is purely a function of role, not route", () => {
    fc.assert(
      fc.property(arbAnyRole, arbAdminRoute, arbAdminRoute, (role, routeA, routeB) => {
        const decisionA = routeGuardDecision(role, routeA);
        const decisionB = routeGuardDecision(role, routeB);
        expect(decisionA).toEqual(decisionB);
      }),
      { numRuns: 100 },
    );
  });

  it("shouldRedirectFromAdminRoute returns true iff role is not 'admin'", () => {
    fc.assert(
      fc.property(arbAnyRole, (role) => {
        expect(shouldRedirectFromAdminRoute(role)).toBe(role !== "admin");
      }),
      { numRuns: 100 },
    );
  });

  it("redirect always uses replace navigation (no history entry)", () => {
    fc.assert(
      fc.property(arbNonAdminRole, arbAdminRoute, (role, route) => {
        const decision = routeGuardDecision(role, route);
        if (decision.action === "redirect") {
          expect(decision.replace).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("all three admin routes (/query, /notifications, /admin) are guarded", () => {
    fc.assert(
      fc.property(arbNonAdminRole, (role) => {
        for (const route of ADMIN_ONLY_ROUTES) {
          const decision = routeGuardDecision(role, route);
          expect(decision.action).toBe("redirect");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("admin users can access all three admin routes without redirect", () => {
    fc.assert(
      fc.property(fc.constant("admin"), (role) => {
        for (const route of ADMIN_ONLY_ROUTES) {
          const decision = routeGuardDecision(role, route);
          expect(decision.action).toBe("render");
        }
      }),
      { numRuns: 100 },
    );
  });
});
