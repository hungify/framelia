#!/usr/bin/env node
// Fails if package.json's "dependencies" ever contains anything but zod.
// @framelia/contracts sits at the base of the monorepo's dependency graph --
// every other workspace package depends on it, directly or transitively, so
// it must never gain a real dependency of its own (workspace or otherwise).
// This was previously a convention ("zero monorepo dependencies") with
// nothing enforcing it; this script makes it a build-breaking invariant.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const ALLOWED_DEPENDENCIES = new Set(["zod"]);

const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
const dependencies = Object.keys(packageJson.dependencies ?? {});
const disallowed = dependencies.filter((name) => !ALLOWED_DEPENDENCIES.has(name));

if (disallowed.length > 0) {
  console.error(
    `@framelia/contracts must have zero monorepo/runtime dependencies beyond zod, found: ${disallowed.join(", ")}`,
  );
  console.error(
    "This package sits below every other workspace package -- adding a dependency here breaks that invariant for the whole monorepo.",
  );
  process.exit(1);
}

console.log(`zero-deps OK: dependencies are exactly [${dependencies.join(", ")}].`);
