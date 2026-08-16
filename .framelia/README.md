# Framelia Playwright quickstart

Framelia owns capture and comparison. Your Playwright test owns navigation, auth, and interaction.

## Install

```bash
npm install --save-dev @framelia/playwright @playwright/test
npx playwright install chromium
```

Set Figma credentials:

```bash
export FIGMA_ACCESS_TOKEN="..."
export FRAMELIA_FIGMA_FILE_KEY="..."
```

## Register matchers

Use typed `expect`:

```ts
import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test("login matches Figma", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/login");
  await expect(page).toMatchFigma("153:5181");
});
```

Or import `@framelia/playwright/register` once from test setup.

## Live dashboard and persisted evidence

Register Reporter in `playwright.config.ts`:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

Reporter streams results over SSE and writes Figma matcher evidence under
`.framelia/visual-verifications/`. Final Figma evidence includes `visual-score.json`, `run-meta.json`,
`punch-list.json`, hashes, and `visual-verification.json`.

```bash
npx playwright test
npx framelia done-gate \
  --artifact .framelia/visual-verifications/<test-id>/visual-verification.json
```

## Web-to-web matchers

`toMatchPage` compares two pages already prepared by your test. `toMatchUrl` opens a page in the
same browser context, so caller cookies/session carry over. These results are live dashboard and
Playwright attachment results; persisted done-gate contracts remain Figma-baselined by design.
