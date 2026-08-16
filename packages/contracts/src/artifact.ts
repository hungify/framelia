import * as z from "zod";

import {
  MAX_CONTRACTS_PER_REQUEST,
  MIN_CONTRACTS_PER_REQUEST,
  SCHEMA_VERSION,
} from "./constants.ts";
import { verificationRequestSchema } from "./request.ts";

const verificationResultSchema = z
  .object({
    id: z.string().min(1),
    ok: z.boolean(),
    pass: z.boolean(),
    error: z.string().optional(),
    message: z.string().optional(),
    outDir: z.string().min(1),
  })
  .strict();

export const verificationArtifactSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    kind: z.literal("framelia.visual-verification"),
    createdAt: z.iso.datetime(),
    projectRoot: z.string().min(1),
    request: verificationRequestSchema,
    ok: z.boolean(),
    allPassed: z.boolean(),
    results: z
      .array(verificationResultSchema)
      .min(MIN_CONTRACTS_PER_REQUEST)
      .max(MAX_CONTRACTS_PER_REQUEST),
  })
  .strict()
  .superRefine((artifact, context) => {
    const requestIds = new Set(artifact.request.contracts.map((contract) => contract.id));
    const resultIds = new Set<string>();
    artifact.results.forEach((result, index) => {
      if (!requestIds.has(result.id)) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "id"],
          message: `result has no matching contract: ${result.id}`,
        });
      }
      if (resultIds.has(result.id)) {
        context.addIssue({
          code: "custom",
          path: ["results", index, "id"],
          message: `duplicate result id: ${result.id}`,
        });
      }
      resultIds.add(result.id);
    });
    if (resultIds.size !== requestIds.size) {
      context.addIssue({
        code: "custom",
        path: ["results"],
        message: "results must cover every request contract exactly once",
      });
    }
    const expectedOk = artifact.results.every((result) => result.ok);
    const expectedAllPassed = artifact.results.every((result) => result.ok && result.pass);
    if (artifact.ok !== expectedOk) {
      context.addIssue({
        code: "custom",
        path: ["ok"],
        message: "ok must equal the aggregate result status",
      });
    }
    if (artifact.allPassed !== expectedAllPassed) {
      context.addIssue({
        code: "custom",
        path: ["allPassed"],
        message: "allPassed must equal the aggregate visual verdict",
      });
    }
  });

export type VerificationArtifact = z.infer<typeof verificationArtifactSchema>;
