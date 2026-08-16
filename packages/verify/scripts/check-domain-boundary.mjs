#!/usr/bin/env node
// Fails if any file under src/capture/domain/ imports @playwright/test.
// oxlint has no no-restricted-imports/no-restricted-paths equivalent, so this
// boundary is enforced by script instead of by lint config.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DOMAIN_ROOT = fileURLToPath(new URL("../src/capture/domain", import.meta.url));
const BANNED = "@playwright/test";
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

function walk(dir) {
  const violations = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      violations.push(...walk(full));
      continue;
    }
    if (!TS_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
    if (readFileSync(full, "utf8").includes(BANNED)) violations.push(full);
  }
  return violations;
}

const violations = walk(DOMAIN_ROOT);
if (violations.length > 0) {
  console.error(`capture/domain/** must not import ${BANNED} (pure decision logic only):`);
  for (const file of violations) console.error(`  ${file}`);
  process.exit(1);
}
console.log("domain boundary OK: no @playwright/test imports under capture/domain/.");
