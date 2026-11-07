import { expect } from "@framelia/playwright";
import { createFrameliaMatchers } from "@framelia/playwright/create-matchers";
import { expect as baseExpect, test as baseTest } from "@playwright/test";

const test = baseTest.extend<{ content: string }>({
  content: "<style>body { margin: 0; background: #246; }</style><button>Continue</button>",
});
const fixtureExpect = baseExpect.extend(createFrameliaMatchers(test));

for (const [name, matcherExpect] of [
  ["typed entrypoint", expect],
  ["consumer fixture factory", fixtureExpect],
] as const) {
  test(name, async ({ page, content }) => {
    const reference = await page.context().newPage();
    await page.setContent(content);
    await reference.setContent(content);
    await matcherExpect(page).toMatchPage(reference);
    await reference.locator("body").evaluate((body) => {
      body.style.background = "#f00";
    });
    await baseExpect(matcherExpect(page).toMatchPage(reference)).rejects.toThrow();
    await reference.close();
  });
}
