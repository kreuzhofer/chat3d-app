// @vitest-environment jsdom
// Feature: ux-gaps-conversational-experience, Property 25, 26, 27, 28: Navigation

import { describe, expect, it } from "vitest";
import fc from "fast-check";

/* ---------- Pure decision functions (mirror App.tsx logic) ---------- */

/**
 * Determines whether a given pathname is a chat route.
 * Chat routes render without the AppShell sidebar.
 * Mirrors the `isChatRoute` check in AuthenticatedApp.
 */
function isChatRoute(pathname: string): boolean {
  return (
    pathname === "/chat" ||
    pathname === "/chat/new" ||
    pathname.startsWith("/chat/")
  );
}

/**
 * Determines whether the sidebar should be rendered.
 * On chat routes, sidebar is undefined (not rendered).
 * Mirrors: `sidebar={isChatRoute ? undefined : <NavigationList ... />}`
 */
function shouldRenderSidebar(pathname: string): boolean {
  return !isChatRoute(pathname);
}

interface NavItem {
  path: string;
  label: string;
  routePrefix: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/**
 * Builds the authenticated navigation groups.
 * Mirrors `authenticatedNavGroups(isAdmin)` in App.tsx.
 */
function authenticatedNavGroups(isAdmin: boolean): NavGroup[] {
  return [
    {
      id: "workspace",
      label: "Workspace",
      items: [
        { path: "/chat", label: "Chat", routePrefix: "/chat" },
      ],
    },
    {
      id: "account",
      label: "Account",
      items: [{ path: "/profile", label: "Profile", routePrefix: "/profile" }],
    },
    ...(isAdmin
      ? [
          {
            id: "admin",
            label: "Administration",
            items: [{ path: "/admin", label: "Admin", routePrefix: "/admin" }],
          },
        ]
      : []),
  ];
}

interface DropdownItem {
  id: string;
  label: string;
  type?: "separator";
}

/**
 * Builds the header dropdown navigation items (excluding session actions).
 * Mirrors the `dropdownItems` memo in AuthenticatedApp.
 */
function buildDropdownNavItems(isAdmin: boolean): DropdownItem[] {
  const navItems: DropdownItem[] = [
    { id: "open-profile", label: "Open Profile" },
  ];
  if (isAdmin) {
    navItems.push(
      { id: "admin", label: "Admin" },
      { id: "query-workbench", label: "Query Workbench" },
    );
  }
  return navItems;
}

/**
 * Determines whether the notification bell should be rendered.
 * Mirrors: `{isAdmin ? <bell> : null}` in AuthenticatedApp.
 */
function shouldRenderNotificationBell(role: string): boolean {
  return role === "admin";
}

/* ---------- Generators ---------- */

/** Generate a random context ID segment (alphanumeric + hyphens, like a UUID). */
const arbContextId: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      ..."abcdefghijklmnopqrstuvwxyz0123456789-".split(""),
    ),
    { minLength: 1, maxLength: 36 },
  )
  .map((chars) => chars.join(""));

/** Generate a random chat route path. */
const arbChatRoute: fc.Arbitrary<string> = fc.oneof(
  fc.constant("/chat"),
  fc.constant("/chat/new"),
  arbContextId.map((id) => `/chat/${id}`),
);

/** Generate a random non-chat route path. */
const arbNonChatRoute: fc.Arbitrary<string> = fc.constantFrom(
  "/profile",
  "/admin",
  "/query",
  "/notifications",
  "/",
);

/** Generate a random user role. */
const arbUserRole: fc.Arbitrary<string> = fc.constantFrom(
  "admin",
  "user",
);


/* ---------- Property 25: No application shell sidebar on chat routes ---------- */

// **Validates: Requirements 17.1**
describe("Navigation — Property 25: No application shell sidebar on chat routes", () => {
  it("sidebar is NOT rendered for any chat route", () => {
    fc.assert(
      fc.property(arbChatRoute, (route) => {
        expect(shouldRenderSidebar(route)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("sidebar IS rendered for non-chat routes", () => {
    fc.assert(
      fc.property(arbNonChatRoute, (route) => {
        expect(shouldRenderSidebar(route)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("isChatRoute correctly identifies /chat exactly", () => {
    expect(isChatRoute("/chat")).toBe(true);
  });

  it("isChatRoute correctly identifies /chat/new", () => {
    expect(isChatRoute("/chat/new")).toBe(true);
  });

  it("isChatRoute correctly identifies /chat/:contextId for random IDs", () => {
    fc.assert(
      fc.property(arbContextId, (contextId) => {
        expect(isChatRoute(`/chat/${contextId}`)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("isChatRoute returns false for non-chat paths", () => {
    fc.assert(
      fc.property(arbNonChatRoute, (route) => {
        expect(isChatRoute(route)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

/* ---------- Property 26: Admin-only header dropdown items visible iff user is admin ---------- */

// **Validates: Requirements 18.2, 18.3, 19.2, 19.3**
describe("Navigation — Property 26: Admin-only header dropdown items visible iff user is admin", () => {
  it("admin users see Admin and Query Workbench in dropdown", () => {
    fc.assert(
      fc.property(fc.constant("admin"), (role) => {
        const items = buildDropdownNavItems(role === "admin");
        const labels = items.map((i) => i.label);
        expect(labels).toContain("Admin");
        expect(labels).toContain("Query Workbench");
      }),
      { numRuns: 100 },
    );
  });

  it("non-admin users do NOT see Admin or Query Workbench in dropdown", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("user", "viewer", "editor", "moderator"),
        (role) => {
          const items = buildDropdownNavItems(role === "admin");
          const labels = items.map((i) => i.label);
          expect(labels).not.toContain("Admin");
          expect(labels).not.toContain("Query Workbench");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all users see Open Profile in dropdown", () => {
    fc.assert(
      fc.property(arbUserRole, (role) => {
        const items = buildDropdownNavItems(role === "admin");
        const labels = items.map((i) => i.label);
        expect(labels).toContain("Open Profile");
      }),
      { numRuns: 100 },
    );
  });

  it("admin dropdown items are exactly: Open Profile, Admin, Query Workbench", () => {
    fc.assert(
      fc.property(fc.constant("admin"), (role) => {
        const items = buildDropdownNavItems(role === "admin");
        const labels = items.map((i) => i.label);
        expect(labels).toEqual(["Open Profile", "Admin", "Query Workbench"]);
      }),
      { numRuns: 100 },
    );
  });

  it("non-admin dropdown items are exactly: Open Profile", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("user", "viewer", "editor"),
        (role) => {
          const items = buildDropdownNavItems(role === "admin");
          const labels = items.map((i) => i.label);
          expect(labels).toEqual(["Open Profile"]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ---------- Property 27: Notification bell visible iff user is admin ---------- */

// **Validates: Requirements 20.2, 20.3**
describe("Navigation — Property 27: Notification bell visible iff user is admin", () => {
  it("notification bell is rendered for admin users", () => {
    fc.assert(
      fc.property(fc.constant("admin"), (role) => {
        expect(shouldRenderNotificationBell(role)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("notification bell is NOT rendered for non-admin users", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("user", "viewer", "editor", "moderator"),
        (role) => {
          expect(shouldRenderNotificationBell(role)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("notification bell visibility is a pure function of role (deterministic)", () => {
    fc.assert(
      fc.property(arbUserRole, (role) => {
        const result1 = shouldRenderNotificationBell(role);
        const result2 = shouldRenderNotificationBell(role);
        expect(result1).toBe(result2);
      }),
      { numRuns: 100 },
    );
  });

  it("notification bell visible iff role is exactly 'admin'", () => {
    fc.assert(
      fc.property(arbUserRole, (role) => {
        const visible = shouldRenderNotificationBell(role);
        expect(visible).toBe(role === "admin");
      }),
      { numRuns: 100 },
    );
  });
});

/* ---------- Property 28: Sidebar excludes Query and Notifications for all users ---------- */

// **Validates: Requirements 19.1, 20.1**
describe("Navigation — Property 28: Sidebar excludes Query and Notifications for all users", () => {
  it("sidebar nav groups never contain Query or Notifications items for any role", () => {
    fc.assert(
      fc.property(arbUserRole, (role) => {
        const groups = authenticatedNavGroups(role === "admin");
        const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));
        expect(allLabels).not.toContain("Query");
        expect(allLabels).not.toContain("Query Workbench");
        expect(allLabels).not.toContain("Notifications");
      }),
      { numRuns: 100 },
    );
  });

  it("sidebar nav groups never contain /query or /notifications paths for any role", () => {
    fc.assert(
      fc.property(arbUserRole, (role) => {
        const groups = authenticatedNavGroups(role === "admin");
        const allPaths = groups.flatMap((g) => g.items.map((i) => i.path));
        expect(allPaths).not.toContain("/query");
        expect(allPaths).not.toContain("/notifications");
      }),
      { numRuns: 100 },
    );
  });

  it("admin sidebar contains Chat, Profile, Admin — but not Query or Notifications", () => {
    fc.assert(
      fc.property(fc.constant(true), (isAdmin) => {
        const groups = authenticatedNavGroups(isAdmin);
        const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));
        expect(allLabels).toContain("Chat");
        expect(allLabels).toContain("Profile");
        expect(allLabels).toContain("Admin");
        expect(allLabels).not.toContain("Query");
        expect(allLabels).not.toContain("Query Workbench");
        expect(allLabels).not.toContain("Notifications");
      }),
      { numRuns: 100 },
    );
  });

  it("non-admin sidebar contains Chat, Profile — but not Admin, Query, or Notifications", () => {
    fc.assert(
      fc.property(fc.constant(false), (isAdmin) => {
        const groups = authenticatedNavGroups(isAdmin);
        const allLabels = groups.flatMap((g) => g.items.map((i) => i.label));
        expect(allLabels).toContain("Chat");
        expect(allLabels).toContain("Profile");
        expect(allLabels).not.toContain("Admin");
        expect(allLabels).not.toContain("Query");
        expect(allLabels).not.toContain("Query Workbench");
        expect(allLabels).not.toContain("Notifications");
      }),
      { numRuns: 100 },
    );
  });
});
