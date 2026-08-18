import { expect, test } from "../fixtures/pages.fixture";

test.describe("auth entry points", { tag: "@smoke" }, () => {
  test("root redirects to login", async ({ loginPage }) => {
    await loginPage.page.goto("/");
    await expect(loginPage.page).toHaveURL(/\/login$/);
    await expect(loginPage.heading).toBeVisible();
  });

  test("login and signup are available without authentication", async ({
    loginPage,
    signupPage,
  }) => {
    await loginPage.goto();
    await expect(loginPage.heading).toBeVisible();

    await signupPage.goto();
    await expect(signupPage.submitButton).toBeVisible();
  });

  test("app route renders the mock dashboard", async ({ appPage }) => {
    await appPage.goto();
    await expect(appPage.dashboard).toBeVisible();
  });
});
