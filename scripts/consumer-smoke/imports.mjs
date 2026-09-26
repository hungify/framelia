import assert from "node:assert/strict";

import { readContractEntry } from "@framelia/playwright";

await import("@framelia/playwright/register");
await import("@framelia/playwright/create-matchers");
await import("@framelia/playwright/reporter");

// No tsx/Node loader and no Playwright test transform: all public entrypoints
// must load directly from the published JavaScript, with the caller's peer.
const entry = readContractEntry("visual-contract.json", "login.desktop");
assert.ok(entry.ok, entry.ok ? undefined : entry.message);
assert.equal(entry.contract.baseline.scale, 1);
