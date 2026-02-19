import { expect, test } from "@playwright/test";

test.describe("public ux snapshots", () => {
  test("captures key public routes", async ({ page }, testInfo) => {
    const routes = ["/", "/pricing", "/login", "/register", "/waitlist", "/legal", "/imprint"];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const bytes = await page.screenshot({ fullPage: true });
      expect(bytes.byteLength).toBeGreaterThan(0);

      await testInfo.attach(`snapshot-${route.replace(/[^a-z0-9]/gi, "_") || "home"}.png`, {
        body: bytes,
        contentType: "image/png",
      });
    }
  });
});
