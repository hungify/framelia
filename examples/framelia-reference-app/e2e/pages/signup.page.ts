import { BasePage } from "./base.page";

export class SignupPage extends BasePage {
  get nameInput() {
    return this.page.getByLabel("Full name");
  }

  get emailInput() {
    return this.page.getByLabel("Email");
  }

  get passwordInput() {
    return this.page.getByLabel("Password", { exact: true });
  }

  get confirmPasswordInput() {
    return this.page.getByLabel("Confirm password");
  }

  get submitButton() {
    return this.page.getByRole("button", { name: /create account/i });
  }

  get termsCheckbox() {
    return this.page.getByRole("checkbox", { name: /terms of service and privacy policy/i });
  }

  async goto() {
    await this.page.goto("/signup");
  }

  async createAccount(name: string, email: string, password: string) {
    await this.fillControlledInput(this.nameInput, name);
    await this.fillControlledInput(this.emailInput, email);
    await this.fillControlledInput(this.passwordInput, password);
    await this.fillControlledInput(this.confirmPasswordInput, password);
    await this.termsCheckbox.check();
    await this.submitButton.click();
    await this.page.waitForURL(/\/app(?:$|\/)/, { timeout: 10_000 });
  }
}
