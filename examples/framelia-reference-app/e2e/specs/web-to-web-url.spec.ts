import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test("toMatchUrl compares login page with auth fixture URL", async ({ page, baseURL }) => {
  await page.goto("/login");
  await expect(page).toMatchUrl(new URL("/login?fixture=reference", baseURL).toString(), {
    fullPage: true,
  });
});
