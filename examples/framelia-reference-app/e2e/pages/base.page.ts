import type { Locator, Page } from "@playwright/test";

export abstract class BasePage {
  constructor(readonly page: Page) {}

  async fillControlledInput(input: Locator, value: string) {
    await input.click();
    await input.press("ControlOrMeta+A");
    await input.pressSequentially(value);
  }
}
