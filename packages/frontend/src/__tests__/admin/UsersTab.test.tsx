// @vitest-environment jsdom
// Feature: 001-design-debt-resolution, Property 5: UsersTab renders all user emails

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { AdminUser } from "../../api/admin.api";
import type { UserRole, UserStatus } from "../../auth/types";
import { UsersTab } from "../../components/admin/UsersTab";

/* ---------- Generators ---------- */

const userRoleArb: fc.Arbitrary<UserRole> = fc.constantFrom("admin", "user");

const userStatusArb: fc.Arbitrary<UserStatus> = fc.constantFrom(
  "active",
  "deactivated",
  "pending_registration",
);

const emailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 12, unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')) }),
    fc.constantFrom("example.com", "test.org", "mail.net", "dev.io"),
  )
  .map(([local, domain]) => `${local}@${domain}`);

const adminUserArb: fc.Arbitrary<AdminUser> = fc.record({
  id: fc.uuid(),
  email: emailArb,
  displayName: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 30 })),
  role: userRoleArb,
  status: userStatusArb,
  deactivatedUntil: fc.constant(null),
  createdAt: fc.constant("2025-01-01T00:00:00.000Z"),
});

const adminUserListArb: fc.Arbitrary<AdminUser[]> = fc.array(adminUserArb, {
  minLength: 1,
  maxLength: 10,
});

/* ---------- Helpers ---------- */

const noop = () => {};

/* ---------- Property Test ---------- */

// **Validates: Requirements 2.5**
describe("UsersTab — Property 5: renders all user emails", () => {
  afterEach(cleanup);

  it("renders every user's email when statusFilter is 'all'", () => {
    fc.assert(
      fc.property(adminUserListArb, (users) => {
        const { container } = render(
          <UsersTab
            users={users}
            search=""
            statusFilter="all"
            busyUserIds={new Set()}
            onSearchChange={noop}
            onStatusFilterChange={noop}
            onSelectUser={noop}
          />,
        );

        const text = container.textContent ?? "";

        for (const user of users) {
          expect(text).toContain(user.email);
        }

        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
