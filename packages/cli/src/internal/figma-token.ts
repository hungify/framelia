import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { errorCode } from "./outcome.ts";

export const FIGMA_TOKEN_MISSING_MESSAGE =
  "FIGMA_ACCESS_TOKEN is not set. Set it in .env.local or .env in the project root, or export it in your shell before running this command.";

export function optionalFigmaToken(runtime: CliRuntime): string | undefined {
  const token = runtime.env.FIGMA_ACCESS_TOKEN?.trim();
  return token === "" ? undefined : token;
}

export function requireFigmaToken(runtime: CliRuntime): string {
  const token = optionalFigmaToken(runtime);
  if (token) return token;
  throw new UsageError(FIGMA_TOKEN_MISSING_MESSAGE, { code: "FIGMA_TOKEN_MISSING" });
}

/**
 * A Figma acquisition that failed while no token was configured is reported as the missing
 * token it almost certainly is, so the outcome says how to fix it instead of only "failed".
 */
export function explainFigmaFailure(error: unknown, runtime: CliRuntime): unknown {
  if (errorCode(error) !== "BASELINE_ACQUISITION_FAILED") return error;
  if (optionalFigmaToken(runtime) !== undefined) return error;
  return new UsageError(FIGMA_TOKEN_MISSING_MESSAGE, { code: "FIGMA_TOKEN_MISSING", cause: error });
}
