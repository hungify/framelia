import { toJsonSchema } from "@framelia/contracts";
import {
  authoredContractSchema,
  signedAuthoritativeRunRequirementsSchema,
} from "@framelia/contracts/workflow";

import type { SchemaTarget } from "../cli-constants.ts";
import type { CliResult } from "../output.ts";

export interface SchemaOptions {
  readonly target: SchemaTarget;
}

export function schemaCommand(options: SchemaOptions): CliResult<Record<string, unknown>> {
  const schema =
    options.target === "requirements"
      ? signedAuthoritativeRunRequirementsSchema
      : authoredContractSchema;
  return { ok: true, body: toJsonSchema(schema) };
}
