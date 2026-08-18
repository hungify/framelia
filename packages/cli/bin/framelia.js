#!/usr/bin/env node
import { register } from "tsx/esm/api";

// Only the CLI's own code is precompiled (dist/cli.js). A user's
// framelia.config.ts is arbitrary TypeScript, dynamically imported at
// runtime -- register a loader hook once, up front, so that plain import()
// calls anywhere downstream (see src/config.ts) transparently handle it.
//
// This is why "tsx" is a dependency, not a devDependency, in package.json:
// it isn't a dev-time convenience here, it's the runtime mechanism that
// makes framelia.config.ts loadable in a published install. Do not move it.
register();

const { run } = await import("../dist/cli.js");
await run();
