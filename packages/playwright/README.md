# @framelia/playwright

Playwright custom matchers for Figma-to-web and web-to-web visual comparison.

```bash
npm install --save-dev @framelia/playwright @playwright/test
```

`@playwright/test` is a peer dependency. Package shares consumer's `expect` instance.

## Quickstart

Framelia owns capture and comparison. Your Playwright test owns navigation, auth, and interaction.

Set Figma credentials:

```bash
export FIGMA_ACCESS_TOKEN="..."
export FRAMELIA_FIGMA_FILE_KEY="..."
```

Register matchers with typed `expect`:

```ts
import { expect } from "@framelia/playwright";
import { test } from "@playwright/test";

test("login matches Figma", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/login");
  await expect(page).toMatchFigma("153:5181");
});
```

Or import `@framelia/playwright/register` once from test setup.

Register Reporter in `playwright.config.ts` for live dashboard events and persisted evidence:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

```bash
npx playwright test
npx framelia done-gate \
  --artifact .framelia/visual-verifications/<test-id>/visual-verification.json
```

Reporter writes matcher evidence under `.framelia/visual-verifications/`. Final Figma evidence
includes `visual-score.json`, `run-meta.json`, `punch-list.json`, hashes, and
`visual-verification.json`.

### Web-to-web matchers

`toMatchPage` compares two pages already prepared by your test. `toMatchUrl` opens a page in the
same browser context, so caller cookies/session carry over. These results are live dashboard and
Playwright attachment results; persisted done-gate contracts remain Figma-baselined by design.

## Matchers

```ts
import { expect } from "@framelia/playwright";

await expect(page).toMatchFigma("153:5181", {
  fileKey: process.env.FRAMELIA_FIGMA_FILE_KEY,
});
await expect(page).toMatchPage(referencePage);
await expect(page).toMatchUrl("http://127.0.0.1:3000/reference");
```

Matchers never own caller page navigation, authentication, or browser setup. `toMatchUrl` only
creates a page in the received page's browser context and navigates that URL.

Options support `selector`, `fullPage`, `masks`, `profile`, font policy, and animation policy.
Figma region captures may provide `expectSize`; this becomes part of persisted contract evidence.

## Reporter

Register `@framelia/playwright/reporter` to get live dashboard events and durable Figma matcher
artifacts:

```ts
export default defineConfig({
  reporter: [["@framelia/playwright/reporter"], ["html"]],
});
```

Reporter reads matcher score/image attachments from Playwright's main process boundary. Each Figma
matcher call gets its own evidence directory. Passing calls attach expected/actual/diff images so
Reporter can persist the same evidence required by `framelia done-gate`.

Web-to-web matcher results remain runtime/dashboard evidence. Contract and done-gate artifacts are
Figma-baselined after schema-v4 pivot.

## Consumer reference app

See [`examples/framelia-reference-app/`](../../examples/framelia-reference-app/) for a standalone TanStack Start consumer showing Better Auth, protected routes, auth storage state, deterministic visual fixtures, Reporter configuration, and all three matchers.
