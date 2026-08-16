import { expect } from "@playwright/test";

import { toMatchFigma } from "./matchers/to-match-figma.ts";
import { toMatchPage } from "./matchers/to-match-page.ts";
import { toMatchUrl } from "./matchers/to-match-url.ts";

/**
 * Side-effect registration: extends `@playwright/test`'s own `expect`
 * singleton so the matchers are callable with zero setup. No compile-time
 * typing — import `expect` from `@framelia/playwright` instead for that.
 */
expect.extend({ toMatchFigma, toMatchPage, toMatchUrl });
