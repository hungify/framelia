import * as path from "node:path";

import { authoredContractSchema, type AuthoredContract } from "@framelia/contracts/workflow";
import {
  AppError,
  assertRawFileState,
  canonicalJsonDigest,
  publishBaselineSnapshot,
  readRawFileState,
  stageFigmaBaseline,
  withAuthoringLock,
  writeAuthoredContract,
  type CanonicalJsonValue,
  type FetchBaselineFn,
  type StageFigmaBaselineOptions,
} from "@framelia/verify";
import {
  inspectAuthoredContracts,
  type DiscoveredAuthoredContract,
  type InvalidAuthoredContract,
  type ResolvedProjectPolicy,
} from "@framelia/verify/project-policy";

export interface PinContractRequest {
  /** Absolute path of the contract pointer to write. */
  readonly contractPath: string;
  /** The contract this pin replaces, as observed when pinning opened; undefined creates one. */
  readonly existing: DiscoveredAuthoredContract | undefined;
  /** The next contract revision; its `baseline` is replaced by the newly staged snapshot. */
  readonly draft: AuthoredContract;
  readonly source: StageFigmaBaselineOptions["source"];
  readonly token: string | undefined;
  readonly fetchBaseline?: FetchBaselineFn;
  /** Test seam: runs after the snapshot is published and before the pointer is written. */
  readonly afterSnapshotPublished?: () => void;
}

export interface PinnedContract {
  readonly contract: AuthoredContract;
  readonly digest: `sha256:${string}`;
  readonly snapshotDigest: `sha256:${string}`;
}

export interface ContractPinning {
  /** Valid authored contracts observed when pinning opened. */
  readonly contracts: readonly DiscoveredAuthoredContract[];
  /**
   * Stages a Figma baseline outside the authoring lock, then, under the lock, proves that
   * neither the config, the contract pointer, nor contract ownership changed since this
   * pinning opened, publishes the immutable snapshot and writes the pointer last. Any
   * failure leaves the previously pinned contract usable.
   */
  readonly pin: (request: PinContractRequest) => Promise<PinnedContract>;
}

function assertInspectionValid(invalid: readonly InvalidAuthoredContract[]): void {
  const first = invalid[0];
  if (!first) return;
  const details = invalid.map((entry) => `${entry.code}: ${entry.message}`).join("; ");
  throw new AppError(
    first.code,
    `Contract discovery must be repaired before authoring: ${details}`,
  );
}

function samePath(root: string, absolute: string, projectRelative: string): boolean {
  return path.resolve(root, projectRelative) === path.resolve(absolute);
}

/** Captures the config state and valid contract set every later `pin` is checked against. */
export async function openContractPinning(policy: ResolvedProjectPolicy): Promise<ContractPinning> {
  const configBefore = policy.configPath ? readRawFileState(policy.configPath) : undefined;
  const inspection = await inspectAuthoredContracts(policy);
  assertInspectionValid(inspection.invalid);

  async function pin(request: PinContractRequest): Promise<PinnedContract> {
    const { contractPath, existing } = request;
    const before = readRawFileState(contractPath);
    const staged = await stageFigmaBaseline({
      source: request.source,
      viewport: request.draft.viewport,
      scope: request.draft.scope,
      token: request.token,
      ...(request.fetchBaseline ? { fetchBaseline: request.fetchBaseline } : {}),
    });
    const contract = authoredContractSchema.parse({
      ...request.draft,
      baseline: { snapshotDigest: staged.snapshotDigest },
    });

    await withAuthoringLock(policy.root, async () => {
      assertRawFileState(contractPath, before);
      if (policy.configPath && configBefore) assertRawFileState(policy.configPath, configBefore);
      const latest = await inspectAuthoredContracts(policy);
      assertInspectionValid(latest.invalid);
      const owner = latest.contracts.find((entry) => entry.contract.id === contract.id);
      if (existing) {
        if (
          owner?.file !== existing.file ||
          owner.digest !== existing.digest ||
          !samePath(policy.root, contractPath, existing.file)
        ) {
          throw new AppError(
            "AUTHORING_CONFLICT",
            `Contract ${contract.id} changed while baseline acquisition was in progress.`,
          );
        }
      } else if (owner) {
        throw new AppError(
          "AUTHORING_CONFLICT",
          `Contract ${contract.id} was created concurrently at ${owner.file}.`,
        );
      }
      await publishBaselineSnapshot(policy.root, contract, staged);
      request.afterSnapshotPublished?.();
      writeAuthoredContract(contractPath, contract);
    });

    return {
      contract,
      digest: canonicalJsonDigest(contract as CanonicalJsonValue),
      snapshotDigest: staged.snapshotDigest,
    };
  }

  return { contracts: inspection.contracts, pin };
}
