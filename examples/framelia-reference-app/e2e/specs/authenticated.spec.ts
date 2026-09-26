import { expect, test } from "../fixtures/pages.fixture";

test.describe("authenticated routes", { tag: "@auth" }, () => {
  test("dashboard and settings are available with storage state", async ({ appPage }) => {
    await appPage.goto();
    await expect(appPage.dashboard).toBeVisible();
    await expect(appPage.recentTransactions).toBeVisible();
    await expect(appPage.revenueStat).toBeVisible();

    await appPage.gotoSettings();
    await expect(appPage.settings).toBeVisible();
    await expect(appPage.emailInput).toBeVisible();
  });

  test("user can sign out", async ({ appPage, loginPage }) => {
    await appPage.goto();
    await appPage.signOut();
    await expect(loginPage.heading).toBeVisible();
    await expect(appPage.page).toHaveURL(/\/login$/);
  });
});
