import { expect, test } from "@playwright/test";

test("side-effect registration", async ({ page }) => {
  await import("@framelia/playwright/register");
  const reference = await page.context().newPage();
  await page.setContent("<button>Continue</button>");
  await reference.setContent("<button>Continue</button>");
  await expect(page).toMatchPage(reference);
  await reference.close();
});
