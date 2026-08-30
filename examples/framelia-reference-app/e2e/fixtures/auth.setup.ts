import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./pages.fixture";

const authFile = path.resolve("playwright/.auth/user.json");

const e2eUser = {
  name: "E2E User",
  email: "demo@framelia.local",
  password: "framelia-demo-password",
};

test("create deterministic e2e session+", async ({ appPage, loginPage, signupPage }) => {
  await signupPage.goto();
  const signedUp = await signupPage
    .createAccount(e2eUser.name, e2eUser.email, e2eUser.password)
    .then(() => true)
    .catch(() => false);

  if (!signedUp) {
    await loginPage.goto();
    await loginPage.login(e2eUser.email, e2eUser.password);
  }

  await expect(appPage.dashboard).toBeVisible();
  await fs.mkdir(path.dirname(authFile), { recursive: true });
  await appPage.page.context().storageState({ path: authFile });
});
