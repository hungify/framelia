import * as z from "zod";

export function toJsonSchema(schema: z.core.$ZodType): Record<string, unknown> {
  // io: "input" — the contract schema ends in a .transform() (outDir default
  // derivation), which z.toJSONSchema() cannot represent under the default
  // "output" mode. "input" describes what a caller may write, which is what
  // this command's consumers (contract authors) actually want anyway.
  return z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
}
