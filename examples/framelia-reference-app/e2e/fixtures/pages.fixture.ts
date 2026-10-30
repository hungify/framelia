import { test as base, expect } from "@playwright/test";

import { AppPage } from "../pages/app.page";
import { LoginPage } from "../pages/login.page";
import { SignupPage } from "../pages/signup.page";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (set it in .env.e2e)`);
  return value;
}

export type E2eUser = { name: string; email: string; password: string };

type Pages = {
  appPage: AppPage;
  loginPage: LoginPage;
  signupPage: SignupPage;
  e2eUser: E2eUser;
};

export const test = base.extend<Pages>({
  appPage: async ({ page }, use) => {
    await use(new AppPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  signupPage: async ({ page }, use) => {
    await use(new SignupPage(page));
  },
  // Only resolved for tests that declare it -- unauthenticated specs never pay for it.
  e2eUser: async ({}, use) => {
    await use({
      name: "E2E User",
      email: requireEnv("E2E_USER_EMAIL"),
      password: requireEnv("E2E_USER_PASSWORD"),
    });
  },
});

export { expect };
