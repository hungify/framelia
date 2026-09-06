import { expect, test } from "@playwright/test";

import { createFrameliaMatchers } from "./create-matchers.ts";

/**
 * Side-effect registration: extends `@playwright/test`'s own `expect`
 * singleton so the matchers are callable with zero setup. No compile-time
 * typing — import `expect` from `@framelia/playwright` instead for that.
 *
 * Real, module-scope `@playwright/test` import required for the same reason as
 * index.ts's `expect` export (see its doc comment).
 *
 * Registers only toMatchFigma/toMatchPage/toMatchUrl, not toMatchPageBaseline --
 * this mirrors this file's pre-existing registered set exactly (frozen by phase 0's
 * public-contract snapshot); import `expect` from `@framelia/playwright` instead for
 * toMatchPageBaseline via the zero-config path.
 */
const { toMatchFigma, toMatchPage, toMatchUrl } = createFrameliaMatchers(test);
expect.extend({ toMatchFigma, toMatchPage, toMatchUrl });
