import * as fs from "node:fs";
import * as path from "node:path";

import { authoredContractSchema } from "@framelia/contracts/workflow";
import * as z from "zod";

import { fsyncDirectory, writeFileAtomic } from "./fs-atomic.ts";
import { AppError } from "./types.ts";

const MIGRATION_TRANSACTION_FILE = [".framelia", "migration.transaction"] as const;

/**
 * One contract's planned replacement inside a `contract migrate` transaction. Recovery
 * is self-contained: `newContract` is the exact, fully-resolved object about to be
 * written (not just its digest), so a crash at any point can be finished by replaying
 * `writeAuthoredContract(newFile, newContract)` -- content a digest alone could never
 * reconstruct -- followed by the (independently idempotent) legacy-side cleanup. The
 * referenced `baseline.snapshotDigest` snapshot is always already durably published by
 * the time this marker is written (staging/publishing happens before the transaction
 * window opens, exactly like `contract create`/`refresh-baseline`), so recovery never
 * needs to touch `.framelia/baselines/`.
 */
const migrationTransactionTargetSchema = z
  .object({
    contractId: z.string().min(1),
    legacyFile: z.string().min(1),
    /** `sha256:<hex>` digest of the legacy file's raw bytes, read immediately before the
     *  transaction acquired the authoring lock -- recorded for audit; the CAS check
     *  itself runs once, before this marker is written. */
    legacyFileDigestBefore: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    /** Whether the legacy file is deleted outright (every contract entry it held has now
     *  migrated) or rewritten with this entry removed (siblings remain legacy). */
    legacyAction: z.enum(["delete-file", "rewrite-file"]),
    newFile: z.string().min(1),
    newContract: authoredContractSchema,
  })
  .strict();

const migrationTransactionRecordSchema = z
  .object({
    formatVersion: z.literal(1),
    kind: z.literal("framelia.migration-transaction"),
    startedAt: z.string(),
    pid: z.number().int().positive(),
    token: z.string().min(1),
    targets: z.array(migrationTransactionTargetSchema).min(1),
  })
  .strict();

export type MigrationTransactionTarget = z.infer<typeof migrationTransactionTargetSchema>;
export type MigrationTransactionRecord = z.infer<typeof migrationTransactionRecordSchema>;

export function migrationTransactionPath(root: string): string {
  return path.join(root, ...MIGRATION_TRANSACTION_FILE);
}

/**
 * Reads and validates the transaction marker, if one exists. A marker that exists but
 * fails schema validation is never treated as absent -- an unreadable marker is exactly
 * as untrustworthy as a half-applied one, so it still blocks `check`/`contract list`
 * and requires the same explicit `contract migrate --recover` (or manual inspection).
 */
export function readMigrationTransaction(root: string): MigrationTransactionRecord | undefined {
  const markerPath = migrationTransactionPath(root);
  if (!fs.existsSync(markerPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new AppError(
      "MIGRATION_TRANSACTION_INVALID",
      `Migration transaction marker at ${markerPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}. Inspect it manually before retrying -- it is never treated as absent.`,
    );
  }
  const result = migrationTransactionRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(
      "MIGRATION_TRANSACTION_INVALID",
      `Migration transaction marker at ${markerPath} failed schema validation: ${z.prettifyError(result.error)}. Inspect it manually before retrying -- it is never treated as absent.`,
    );
  }
  return result.data;
}

export function writeMigrationTransaction(root: string, record: MigrationTransactionRecord): void {
  writeFileAtomic(migrationTransactionPath(root), `${JSON.stringify(record, null, 2)}\n`);
}

export function clearMigrationTransaction(root: string): void {
  const markerPath = migrationTransactionPath(root);
  try {
    fs.unlinkSync(markerPath);
    fsyncDirectory(path.dirname(markerPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * `check` and `contract list` share this guard (via `inspectAuthoredContracts`) so an
 * interrupted multi-file migration can never be read as a valid, complete contract set.
 * The marker's mere presence blocks -- not its content -- since a torn marker is exactly
 * as unsafe to ignore as a torn contract set would be.
 */
export function assertNoPendingMigrationTransaction(root: string): void {
  if (!fs.existsSync(migrationTransactionPath(root))) return;
  throw new AppError(
    "MIGRATION_INCOMPLETE",
    `An interrupted contract migration is pending at ${migrationTransactionPath(root)}. Run "framelia contract migrate --recover --project-root ${root}" before checking or listing contracts.`,
  );
}
