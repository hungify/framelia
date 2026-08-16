import {
  toJsonSchema,
  verificationArtifactSchema,
  verificationRequestSchema,
} from "@framelia/contracts";
import { JSON_INDENT_SPACES } from "@framelia/verify";
import { InvalidArgumentError, type Command } from "commander";

import { subcommand } from "./shared.ts";

type SchemaTarget = "contract" | "artifact";

interface SchemaOptions {
  target: SchemaTarget;
}

function schemaTarget(raw: string): SchemaTarget {
  if (raw !== "contract" && raw !== "artifact") {
    throw new InvalidArgumentError('must be "contract" or "artifact"');
  }
  return raw;
}

function schemaCommand(options: SchemaOptions): void {
  const schema =
    options.target === "artifact" ? verificationArtifactSchema : verificationRequestSchema;
  console.log(JSON.stringify(toJsonSchema(schema), null, JSON_INDENT_SPACES));
}

export function registerSchemaCommand(program: Command): void {
  program.addCommand(
    subcommand(
      "schema",
      "Print the live JSON Schema for a visual contract or verification artifact.",
    )
      .option("--target <contract|artifact>", "schema to print", schemaTarget, "contract")
      .action(schemaCommand),
  );
}
