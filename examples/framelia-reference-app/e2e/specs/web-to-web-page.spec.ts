import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test("toMatchPage compares two prepared auth pages", async ({ page }) => {
  const referencePage = await page.context().newPage();

  await referencePage.goto("/login?fixture=reference");
  await page.goto("/login?fixture=actual");
  await expect(page).toMatchPage(referencePage, { fullPage: true });

  await referencePage.close();
});
