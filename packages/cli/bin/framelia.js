#!/usr/bin/env node
// Config loading installs the TypeScript loader only when a config file is present.
import { run } from "../dist/cli.js";

await run();
