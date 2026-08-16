# @framelia/playwright

Playwright custom matchers for Figma-to-web and web-to-web visual comparison.

```bash
npm install --save-dev @framelia/playwright @playwright/test
```

`@playwright/test` is a peer dependency. Package shares consumer's `expect` instance.

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
