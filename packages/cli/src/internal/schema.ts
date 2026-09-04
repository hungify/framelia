import {
  toJsonSchema,
  verificationArtifactSchema,
  verificationRequestSchema,
} from "@framelia/contracts";

export interface SchemaOptions {
  readonly target: "contract" | "artifact";
}

export function schemaCommand(options: SchemaOptions): Record<string, unknown> {
  const schema =
    options.target === "artifact" ? verificationArtifactSchema : verificationRequestSchema;
  return toJsonSchema(schema);
}
