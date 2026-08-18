import { BasePage } from "./base.page";

export class AppPage extends BasePage {
  get dashboard() {
    return this.page.getByTestId("dashboard-page");
  }

  get settings() {
    return this.page.getByTestId("settings-page");
  }

  get latestOrders() {
    return this.page.getByText("Latest orders");
  }

  get fulfillmentHealth() {
    return this.page.getByText("96.4%");
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
