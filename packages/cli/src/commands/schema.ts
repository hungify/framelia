import { buildCommand } from "@stricli/core";

import { SCHEMA_TARGETS } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { SchemaOptions } from "../internal/schema.ts";
import { emitResult } from "../output.ts";

export const schemaCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; keep schema dependencies off startup.
    const { schemaCommand: runSchemaCommand } = await import("../internal/schema.ts");
    return function (this: CliContext, flags: SchemaOptions) {
      emitResult(this, runSchemaCommand(flags));
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
  },
  docs: {
    brief: "Print the live JSON Schema for an authored contract or signed requirements.",
    fullDescription: [
      "Print the live JSON Schema for an authored visual contract (default) or the",
      "signed authoritative requirements envelope.",
      "",
      "Examples:",
      "  framelia schema",
      "  framelia schema --target requirements",
    ].join("\n"),
  },
});
