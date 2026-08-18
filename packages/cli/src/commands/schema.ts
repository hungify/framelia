import {
  toJsonSchema,
  verificationArtifactSchema,
  verificationRequestSchema,
} from "@framelia/contracts";
import { JSON_INDENT_SPACES } from "@framelia/verify";
import { Option, type Command } from "commander";

import { subcommand } from "./shared.ts";

const SCHEMA_TARGETS = ["contract", "artifact"] as const;
type SchemaTarget = (typeof SCHEMA_TARGETS)[number];

interface SchemaOptions {
  target: SchemaTarget;
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
      .addOption(
        new Option("--target <contract|artifact>", "schema to print")
          .choices(SCHEMA_TARGETS)
          .default("contract"),
      )
      .action(schemaCommand),
  );
}
