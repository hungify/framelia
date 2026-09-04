import {
  toJsonSchema,
  verificationArtifactSchema,
  verificationRequestSchema,
} from "@framelia/contracts";

import type { SchemaTarget } from "../cli-constants.ts";
import type { CliResult } from "../output.ts";

export interface SchemaOptions {
  readonly target: SchemaTarget;
}

export function schemaCommand(options: SchemaOptions): CliResult<Record<string, unknown>> {
  const schema =
    options.target === "artifact" ? verificationArtifactSchema : verificationRequestSchema;
  return { ok: true, body: toJsonSchema(schema) };
}
