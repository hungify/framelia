import type { UIContractResult, UIEvent, UIRun } from "@framelia/contracts";
import { nanoid } from "nanoid";

import { overallStatus, summarize } from "./model.ts";

type UIFileMap = Map<string, string>;
type Listener = (event: UIEvent) => void;

export interface ReporterStoreSeed {
  id: string;
  name: string;
  tags: string[];
}

/**
 * Reporter-facing live store: one mutation method, `recordResult`,
 * that transitions a contract from `queued` straight to a terminal status.
 * A Playwright Reporter only observes whole-test results via `onTestEnd`,
 * so there is no intermediate phase to report.
 */
export class ReporterStore {
  readonly #listeners = new Set<Listener>();
  readonly #run: UIRun;
  #files: UIFileMap = new Map();
  #sequence = 0;

  constructor(seeds: ReporterStoreSeed[], suiteName?: string, now = new Date()) {
    const timestamp = now.toISOString();
    const contracts: UIContractResult[] = seeds.map((seed) => ({
      id: seed.id,
      name: seed.name,
      tags: seed.tags,
      status: "queued",
      phase: "queued",
      baselineKind: "figma",
      capture: { kind: "viewport", viewport: { width: 0, height: 0 } },
      blockers: [],
    }));
    this.#run = {
      schemaVersion: 1,
      runId: nanoid(),
      ...(suiteName ? { suiteName } : {}),
      status: "queued",
      summary: summarize(contracts),
      contracts,
      startedAt: timestamp,
      updatedAt: timestamp,
    };
  }

  snapshot(): UIRun {
    return structuredClone(this.#run);
  }

  files(): UIFileMap {
    return new Map(this.#files);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Replaces the seeded `queued` entry for `contractId` with its terminal result. */
  recordResult(
    contractId: string,
    result: UIContractResult,
    files: Iterable<readonly [string, string]> = [],
  ): void {
    const index = this.#run.contracts.findIndex((contract) => contract.id === contractId);
    if (index === -1) {
      console.error(
        `framelia ui: recordResult got unknown contractId "${contractId}" (not in the seeded run); result dropped.`,
      );
      return;
    }
    this.#run.contracts[index] = result;
    for (const [key, value] of files) this.#files.set(key, value);
    this.#run.summary = summarize(this.#run.contracts);
    this.#run.status = overallStatus(this.#run.summary);
    this.#run.updatedAt = new Date().toISOString();
    this.#emit({ contractId, phase: result.phase, status: result.status });
  }

  /** Recomputes status/summary once more (covers a zero-test run, which never calls recordResult) and marks the run finished. */
  finish(): void {
    this.#run.summary = summarize(this.#run.contracts);
    this.#run.status = overallStatus(this.#run.summary);
    this.#run.finishedAt = new Date().toISOString();
    this.#emit({ status: this.#run.status });
  }

  #emit(input: Omit<UIEvent, "sequence" | "runId" | "timestamp">): void {
    const event: UIEvent = {
      sequence: ++this.#sequence,
      runId: this.#run.runId,
      timestamp: new Date().toISOString(),
      ...input,
    };
    for (const listener of this.#listeners) listener(event);
  }
}
