import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./pages.fixture";

const authFile = path.resolve("playwright/.auth/user.json");

test("create deterministic e2e session", async ({ appPage, loginPage, signupPage, e2eUser }) => {
  test.setTimeout(45_000);

  await loginPage.goto();
  const loggedIn = await loginPage
    .login(e2eUser.email, e2eUser.password)
    .then(() => true)
    .catch(() => false);

  if (!loggedIn) {
    await signupPage.goto();
    await signupPage.createAccount(e2eUser.name, e2eUser.email, e2eUser.password);
  }

  await expect(appPage.dashboard).toBeVisible();
  await fs.mkdir(path.dirname(authFile), { recursive: true });
  await appPage.page.context().storageState({ path: authFile });
});
