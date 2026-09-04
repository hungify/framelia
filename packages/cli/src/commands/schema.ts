import { buildCommand } from "@stricli/core";

import type { CliContext } from "../context.ts";
import { emitResult } from "../output.ts";

const SCHEMA_TARGETS = ["contract", "artifact"] as const;
type SchemaTarget = (typeof SCHEMA_TARGETS)[number];

interface SchemaFlags {
  readonly target: SchemaTarget;
}

export const schemaCommand = buildCommand({
  loader: async () => {
    const { schemaCommand: runSchemaCommand } = await import("../internal/schema.ts");
    return function (this: CliContext, flags: SchemaFlags) {
      emitResult(this, runSchemaCommand({ target: flags.target }), true);
    };
  },
  parameters: {
    flags: {
      target: {
        kind: "enum",
        values: SCHEMA_TARGETS,
        default: "contract",
        brief: "schema to print",
      },
    },
    aliases: { t: "target" },
  },
  docs: { brief: "Print the live JSON Schema for a visual contract or verification artifact." },
});
