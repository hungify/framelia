import * as path from "node:path";

import { AppError } from "./types.ts";

export function resolveArtifactPath(input: string, cwd?: string): string {
  if (!input) return input;
  if (path.isAbsolute(input)) return path.normalize(input);
  if (cwd) return path.resolve(cwd, input);
  throw new AppError(
    "MISSING_PROJECT_ROOT",
    `Relative artifact path requires an explicit project root: ${input}`,
  );
}
