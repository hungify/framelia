import { test as base, expect } from "@playwright/test";

import { AppPage } from "../pages/app.page";
import { LoginPage } from "../pages/login.page";
import { SignupPage } from "../pages/signup.page";

type Pages = {
  appPage: AppPage;
  loginPage: LoginPage;
  signupPage: SignupPage;
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
});

export { expect };
