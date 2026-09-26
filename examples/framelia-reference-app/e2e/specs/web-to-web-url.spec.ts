// Demonstrates `toMatchUrl`: the caller navigates and prepares only the received
// Page; the matcher opens a second page **in the same browser context** and
// navigates it to `url` for you, so cookies/session carry over automatically. That
// makes it the matcher to reach for when comparing a protected route against a
// second fixture state without hand-rolling a second page + login -- see
// web-to-web-page.spec.ts for the sibling matcher that instead diffs two pages the
// caller has already prepared itself. No Figma baseline or credentials required;
// results land only as live dashboard and Playwright attachments (see
// @framelia/playwright's README, "Web-to-web matchers").
import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test.describe("toMatchUrl: web-to-web URL comparison", () => {
  test("login renders identically against a second fixture URL in the same context", async ({
    page,
  }) => {
    await page.goto("/login?ref=fixture-a");

    // Same rationale as web-to-web-page.spec.ts: this query fixture is unread by the
    // route, so a pass here proves toMatchUrl ignores it rather than accidentally
    // depending on it.
    await expect(page).toMatchUrl("/login?ref=fixture-b", {
      fullPage: true,
      animationPolicy: "freeze",
      devtoolsSelector: true,
    });
  });
});
