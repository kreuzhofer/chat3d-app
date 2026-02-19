import { expect, test } from "@playwright/test";

test.describe("chat query render flow", () => {
  test("query -> download -> rate -> regenerate", async ({ page, request, baseURL }) => {
    const authEmail = process.env.E2E_AUTH_EMAIL;
    const authPassword = process.env.E2E_AUTH_PASSWORD;

    test.skip(!authEmail || !authPassword, "E2E_AUTH_EMAIL and E2E_AUTH_PASSWORD are required");

    const resolvedBaseUrl = baseURL ?? process.env.E2E_BASE_URL ?? "http://localhost";
    const apiBase = process.env.E2E_API_BASE_URL ?? `${resolvedBaseUrl.replace(/\/$/, "")}/api`;

    const loginResponse = await request.post(`${apiBase}/auth/login`, {
      data: {
        email: authEmail,
        password: authPassword,
      },
    });
    expect(loginResponse.ok()).toBe(true);

    const loginBody = (await loginResponse.json()) as {
      token?: string;
      user?: { id?: string };
    };
    const token = loginBody.token;
    expect(typeof token).toBe("string");

    const createContextResponse = await request.post(`${apiBase}/chat/contexts`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      data: {
        name: `Playwright E2E ${Date.now()}`,
      },
    });
    expect(createContextResponse.ok()).toBe(true);

    const contextBody = (await createContextResponse.json()) as { id?: string };
    const contextId = contextBody.id;
    expect(typeof contextId).toBe("string");

    await page.addInitScript((authToken) => {
      window.localStorage.setItem("chat3d.auth.token", authToken);
    }, token as string);

    await page.goto(`/chat/${encodeURIComponent(contextId as string)}`);

    const promptInput = page.getByTestId("chat-prompt-input").first();
    await expect(promptInput).toBeVisible();
    await promptInput.fill("Generate a simple test cube with chamfered edges.");

    const sendButton = page.getByRole("button", { name: "Send" }).first();
    await sendButton.click();

    await expect(page.getByText("Prompt submitted.")).toBeVisible();

    const downloadStepButton = page.getByRole("button", { name: "Download STEP" }).first();
    await expect(downloadStepButton).toBeEnabled();

    const [download] = await Promise.all([page.waitForEvent("download"), downloadStepButton.click()]);
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename.toLowerCase()).toContain("step");

    const thumbsUpButton = page.getByRole("button", { name: "Thumbs up" }).first();
    await thumbsUpButton.click();

    const regenerateButton = page.getByRole("button", { name: "Regenerate" }).first();
    await regenerateButton.click();

    await expect(page.getByText("Regeneration submitted.")).toBeVisible();
  });
});
