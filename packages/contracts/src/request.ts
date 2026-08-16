import * as z from "zod";

import {
  MAX_CONTRACTS_PER_REQUEST,
  MIN_CONTRACTS_PER_REQUEST,
  SCHEMA_VERSION,
} from "./constants.ts";
import { verificationContractSchema } from "./contract.ts";
import { webTargetSchema } from "./target.ts";

export const verificationRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    target: webTargetSchema,
    contracts: z
      .array(verificationContractSchema)
      .min(MIN_CONTRACTS_PER_REQUEST)
      .max(MAX_CONTRACTS_PER_REQUEST),
  })
  .strict()
  .superRefine((request, context) => {
    const ids = new Set<string>();
    request.contracts.forEach((contract, index) => {
      if (ids.has(contract.id)) {
        context.addIssue({
          code: "custom",
          path: ["contracts", index, "id"],
          message: `duplicate contract id: ${contract.id}`,
        });
      }
      ids.add(contract.id);
    });
  });

export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
