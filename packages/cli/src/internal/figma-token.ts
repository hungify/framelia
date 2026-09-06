import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";

export function optionalFigmaToken(runtime: CliRuntime): string | undefined {
  const token = runtime.env.FIGMA_ACCESS_TOKEN?.trim();
  return token === "" ? undefined : token;
}

export function requireFigmaToken(runtime: CliRuntime): string {
  const token = optionalFigmaToken(runtime);
  if (token) return token;
  throw new UsageError("FIGMA_ACCESS_TOKEN is not set. Export it before running this command.");
}
