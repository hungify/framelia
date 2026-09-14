import assert from "node:assert/strict";

import { authoredContractSchema, CONTRACT_FORMAT_VERSION } from "@framelia/contracts/workflow";
import { readContractEntry } from "@framelia/playwright";
import { defineProjectConfig } from "@framelia/playwright/project-policy";
import { canonicalJsonDigest } from "@framelia/verify/project-policy";

await import("@framelia/playwright/register");
await import("@framelia/playwright/create-matchers");
await import("@framelia/playwright/reporter");

assert.equal(CONTRACT_FORMAT_VERSION, 1);
assert.equal(authoredContractSchema.safeParse({}).success, false);
assert.deepEqual(defineProjectConfig({ playwright: { projects: ["chromium"] } }), {
  playwright: { projects: ["chromium"] },
});
assert.match(canonicalJsonDigest({ published: true }), /^sha256:[0-9a-f]{64}$/);
// No tsx/Node loader and no Playwright test transform: all public entrypoints
// must load directly from the published JavaScript, with the caller's peer.
const entry = readContractEntry("visual-contract.json", "login.desktop");
assert.ok(entry.ok, entry.ok ? undefined : entry.message);
assert.equal(entry.contract.baseline.scale, 1);
