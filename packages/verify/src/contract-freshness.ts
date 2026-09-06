import * as fs from "node:fs";
import * as path from "node:path";

import { z } from "zod";

import { RUN_ARTIFACT } from "./artifacts.ts";
import { JSON_INDENT_SPACES } from "./constants.ts";
import { writeFileAtomic } from "./fs-atomic.ts";

export interface ContractFreshnessReceipt {
  /** Caller-supplied opaque string (e.g. a git SHA) identifying what would rebuild this
   *  contract's target. Framelia never computes or interprets it. */
  fingerprint: string;
  pass: boolean;
  checkedAt: string;
}

const contractFreshnessReceiptSchema = z.object({
  fingerprint: z.string(),
  pass: z.boolean(),
  checkedAt: z.string(),
}) satisfies z.ZodType<ContractFreshnessReceipt>;

export function contractFreshnessPath(outDir: string): string {
  return path.join(outDir, RUN_ARTIFACT.freshness);
}

export function readContractFreshness(outDir: string): ContractFreshnessReceipt | null {
  const filePath = contractFreshnessPath(outDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = contractFreshnessReceiptSchema.safeParse(
      JSON.parse(fs.readFileSync(filePath, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Written via writeFileAtomic so a crash mid-write never leaves a half-written receipt. */
export function writeContractFreshness(outDir: string, receipt: ContractFreshnessReceipt): void {
  writeFileAtomic(
    contractFreshnessPath(outDir),
    `${JSON.stringify(receipt, null, JSON_INDENT_SPACES)}\n`,
  );
}

/** True only if the last recorded check for this exact fingerprint passed. A pure query --
 *  the caller (e.g. via `test.skip`) owns the decision to actually skip. */
export function isContractFresh(outDir: string, fingerprint: string): boolean {
  const receipt = readContractFreshness(outDir);
  return receipt?.pass === true && receipt.fingerprint === fingerprint;
}
