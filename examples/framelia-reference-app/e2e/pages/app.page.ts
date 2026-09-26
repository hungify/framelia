import { BasePage } from "./base.page";

export class AppPage extends BasePage {
  get dashboard() {
    return this.page.getByTestId("dashboard-page");
  }

  get settings() {
    return this.page.getByTestId("settings-page");
  }

  get recentTransactions() {
    return this.page.getByText("Recent transactions");
  }

  get revenueStat() {
    return this.page.getByText("$248,900");
  }

  get emailInput() {
    return this.page.getByLabel("Email");
  }

  get signOutButton() {
    return this.page.getByRole("button", { name: /sign out/i }).first();
  }

  async goto() {
    await this.page.goto("/app");
  }

  async gotoSettings() {
    await this.page.goto("/app/settings");
  }

  async signOut() {
    await this.signOutButton.click();
  }
}
