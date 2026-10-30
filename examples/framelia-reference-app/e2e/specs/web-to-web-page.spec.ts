// Demonstrates `toMatchPage`: diffing two Playwright Pages the caller has already
// prepared, with no Figma baseline involved. Results land only as live dashboard and
// Playwright attachments -- persisted done-gate evidence stays Figma-baselined by
// design (see @framelia/playwright's README, "Web-to-web matchers"). Unlike
// `toMatchUrl`, this matcher never navigates either side itself, so it also works
// across two different browser contexts (e.g. comparing environments or roles) --
// see web-to-web-url.spec.ts for the sibling matcher that navigates pageB for you.
import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test.describe("toMatchPage: web-to-web page comparison", () => {
  test("login renders identically regardless of an unrelated query fixture", async ({
    page,
    context,
  }) => {
    // Two distinct query strings stand in for "two fixture variants" -- neither is
    // read by the login route (see src/routes/_guest/login.tsx), so a pass here
    // proves toMatchPage compares rendered pixels, not URLs: an unrelated query
    // difference must never cause a false mismatch.
    await page.goto("/login?ref=fixture-a");

    const pageB = await context.newPage();
    try {
      await pageB.goto("/login?ref=fixture-b");
      await expect(page).toMatchPage(pageB, {
        fullPage: true,
        animationPolicy: "freeze",
        devtoolsSelector: true,
      });
    } finally {
      await pageB.close();
    }
  });
});
