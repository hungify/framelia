import * as z from "zod";

import {
  MAX_CONTRACTS_PER_REQUEST,
  MIN_CONTRACTS_PER_REQUEST,
  SCHEMA_VERSION,
} from "./constants.ts";
import { assertUniqueIds } from "./shared/unique-ids.ts";
import { webTargetSchema } from "./target.ts";
import { verificationContractSchema } from "./visual-contract.ts";

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
    assertUniqueIds(request.contracts, (contract) => contract.id, context, {
      path: (index) => ["contracts", index, "id"],
      message: (id) => `duplicate contract id: ${id}`,
    });
  });

export type VerificationRequest = z.infer<typeof verificationRequestSchema>;
