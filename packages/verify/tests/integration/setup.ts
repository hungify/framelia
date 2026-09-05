import * as path from "node:path";
import * as url from "node:url";

import { loadProjectEnv } from "../../src/load-env.ts";

const packageRoot = path.dirname(path.dirname(path.dirname(url.fileURLToPath(import.meta.url))));
const monorepoRoot = path.resolve(packageRoot, "../..");

// Integration tests read FIGMA_ACCESS_TOKEN from the monorepo root .env
// (see .env.example) rather than requiring it to already be exported in
// the shell.
loadProjectEnv(monorepoRoot);
