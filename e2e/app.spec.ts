import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const password = "a-long-e2e-test-password";
const accessible = async (page: import("@playwright/test").Page) =>
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);

test("account lifecycle: create, write, restore on a new device, recover and delete", async ({
  browser,
  page,
}, info) => {
  const username = `e2e_${info.project.name}_${Date.now()}`.slice(0, 40);
  await page.goto("/");
  await accessible(page);
  await page.getByRole("button", { name: "Create account or sign in" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create my account" }).click();
  const code = await page
    .getByLabel("Recovery code", { exact: true })
    .innerText();
  expect(code).toMatch(/^[a-f0-9]{64}$/);
  await page
    .getByRole("button", { name: /I’ve saved my recovery code/ })
    .click();
  await page.getByRole("button", { name: "Write a note" }).click();
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/data") && r.request().method() === "PUT" && r.ok(),
  );
  await page.getByLabel("Title").fill("Cross-device note");
  await page.getByRole("button", { name: "Save note" }).click();
  // Wait for the record itself to upload, not just the initial sync.
  await uploaded;
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("Synced", {
    timeout: 15000,
  });
  await accessible(page);

  // A second browser profile acts as a new device.
  const other = await (await browser.newContext()).newPage();
  await other.goto("/");
  await other
    .getByRole("button", { name: "Create account or sign in" })
    .click();
  await other.getByRole("button", { name: "Forgot password" }).click();
  await other
    .getByRole("button", { name: "Use my saved recovery code" })
    .click();
  await other.getByLabel("Username").fill(username);
  await other.getByLabel("Recovery code").fill(code);
  await other.getByLabel("New password").fill(`${password}-2`);
  await other.getByRole("button", { name: "Reset password" }).click();
  await expect(
    other.getByLabel("Recovery code", { exact: true }),
  ).not.toHaveText(code);
  await other
    .getByRole("button", { name: /I’ve saved my recovery code/ })
    .click();
  await other.getByRole("link", { name: "Notes", exact: true }).click();
  await expect(
    other.getByRole("button", { name: /Cross-device note/ }),
  ).toBeVisible();

  await other.getByRole("link", { name: "Settings", exact: true }).click();
  await other.getByRole("button", { name: "Delete account" }).click();
  await other.getByLabel("Confirm with your password").fill(`${password}-2`);
  other.on("dialog", (dialog) => void dialog.accept());
  await other.getByRole("button", { name: "Delete my account" }).click();
  await expect(
    other.getByRole("button", { name: "Create account or sign in" }),
  ).toBeVisible();
});

test("device-only use works offline and the sample stays separate", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore with sample data" }).click();
  await expect(page.getByText(/Sample data · changes/)).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Leave sample" }).click();
  await page.getByRole("button", { name: /Use on this device/ }).click();
  await expect(page.getByText(/Create your first note/)).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Write a note" }).click();
  await page.getByLabel("Title").fill("Offline note");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText(/You have 1 note/)).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText(/You have 1 note/)).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Dark appearance" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Dark appearance" }),
  ).toBeChecked();
  await accessible(page);
});
