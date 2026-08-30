import { BasePage } from "./base.page";

export class LoginPage extends BasePage {
  get heading() {
    return this.page.getByRole("heading", { name: /sign in to framelia/i });
  }

  get emailInput() {
    return this.page.getByTestId("login-email");
  }

  get passwordInput() {
    return this.page.getByTestId("login-password");
  }

  get submitButton() {
    return this.page.getByRole("button", { name: /^sign in$/i });
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.fillControlledInput(this.emailInput, email);
    await this.fillControlledInput(this.passwordInput, password);
    await this.submitButton.click();
    await this.page.waitForURL(/\/app(?:$|\/)/);
  }
}
