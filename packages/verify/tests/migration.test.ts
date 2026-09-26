import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { AuthoredContract } from "@framelia/contracts/workflow";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertNoPendingMigrationTransaction,
  clearMigrationTransaction,
  migrationTransactionPath,
  readMigrationTransaction,
  writeMigrationTransaction,
  type MigrationTransactionRecord,
} from "../src/migration.ts";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-migration-"));
  roots.push(root);
  return root;
}

function sampleContract(id: string): AuthoredContract {
  return {
    formatVersion: 1,
    kind: "framelia.contract",
    id,
    name: "Sample",
    revision: 1,
    target: { path: "/sample" },
    viewport: { preset: "custom", width: 10, height: 10 },
    scope: { kind: "page", pageReason: "fixture" },
    baseline: { snapshotDigest: `sha256:${"a".repeat(64)}` },
    required: true,
  };
}

function sampleRecord(root: string, id: string): MigrationTransactionRecord {
  return {
    formatVersion: 1,
    kind: "framelia.migration-transaction",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    token: "test-token",
    targets: [
      {
        contractId: id,
        legacyFile: "legacy/visual-contract.json",
        legacyFileDigestBefore: `sha256:${"b".repeat(64)}`,
        legacyAction: "delete-file",
        newFile: `.framelia/contracts/${id}/visual-contract.json`,
        newContract: sampleContract(id),
      },
    ],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("migration transaction marker", () => {
  it("round-trips a written record and clears it", () => {
    const root = temporaryRoot();
    expect(readMigrationTransaction(root)).toBeUndefined();
    const record = sampleRecord(root, "login.desktop");
    writeMigrationTransaction(root, record);
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(true);
    expect(readMigrationTransaction(root)).toEqual(record);
    clearMigrationTransaction(root);
    expect(readMigrationTransaction(root)).toBeUndefined();
    expect(fs.existsSync(migrationTransactionPath(root))).toBe(false);
  });

  it("clearing an absent marker is a silent no-op", () => {
    const root = temporaryRoot();
    expect(() => clearMigrationTransaction(root)).not.toThrow();
  });

  it("treats a malformed marker as present and unrecoverable, never as absent", () => {
    const root = temporaryRoot();
    fs.mkdirSync(path.dirname(migrationTransactionPath(root)), { recursive: true });
    fs.writeFileSync(migrationTransactionPath(root), "not json");
    expect(() => readMigrationTransaction(root)).toThrow(
      expect.objectContaining({ code: "MIGRATION_TRANSACTION_INVALID" }),
    );
    // Presence alone blocks -- content is never inspected here, so a malformed marker
    // still reports the same MIGRATION_INCOMPLETE guard (`readMigrationTransaction`
    // above is what surfaces the more specific MIGRATION_TRANSACTION_INVALID).
    expect(() => assertNoPendingMigrationTransaction(root)).toThrow(
      expect.objectContaining({ code: "MIGRATION_INCOMPLETE" }),
    );
  });

  it("assertNoPendingMigrationTransaction blocks with MIGRATION_INCOMPLETE while a marker exists", () => {
    const root = temporaryRoot();
    expect(() => assertNoPendingMigrationTransaction(root)).not.toThrow();
    writeMigrationTransaction(root, sampleRecord(root, "login.desktop"));
    expect(() => assertNoPendingMigrationTransaction(root)).toThrow(
      expect.objectContaining({ code: "MIGRATION_INCOMPLETE" }),
    );
    clearMigrationTransaction(root);
    expect(() => assertNoPendingMigrationTransaction(root)).not.toThrow();
  });
});
