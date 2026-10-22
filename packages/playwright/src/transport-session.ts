import type { Diagnostic, RunContext } from "@framelia/contracts/workflow";
import type { FullResult, Suite, TestCase } from "@playwright/test/reporter";

import { reconcileExecution, type ExecutionBundle } from "./reconcile-execution.ts";
import { writeCollectionManifest, writeTransportStatus } from "./run-context.ts";
import { buildTransportCollection, type TransportCollection } from "./transport-collection.ts";

/**
 * The reporter's side of a coordinated `framelia check` run: in collect mode it reports the
 * Playwright collection back to the CLI; in execute mode it also reconciles that collection
 * with the frozen run plan and reports how the run ended. Direct (uncoordinated) runs never
 * create one.
 */
export class TransportSession {
  readonly #context: RunContext;
  #collection?: TransportCollection;
  #error?: Error;
  #ready = false;
  /** The frozen cases this process executes; set in execute mode once reconciliation passed. */
  #bundle?: ExecutionBundle;
  /** Setup/teardown-project tests seen in execute mode, keyed by test id so retries collapse
   *  into one entry; whether each failed is decided once, at onEnd, from `test.outcome()`
   *  -- a setup test that failed and then passed on retry is flaky, not a setup failure. */
  readonly #graphTests = new Map<
    string,
    { test: TestCase; projectName: string; setup: boolean; teardown: boolean }
  >();

  constructor(context: RunContext, suite: Suite) {
    this.#context = context;
    try {
      this.#collection = buildTransportCollection(suite, context);
      if (context.mode === "execute") {
        writeCollectionManifest(context, this.#collection.manifest);
        this.#bundle = reconcileExecution(context, this.#collection);
        writeTransportStatus(context, "ready");
        this.#ready = true;
      }
    } catch (error) {
      this.#error = error instanceof Error ? error : new Error(String(error));
      if (context.mode === "execute") {
        writeTransportStatus(context, "blocked", [
          { code: "FRAMELIA_EXECUTION_RECONCILIATION", message: this.#error.message },
        ]);
      }
    }
  }

  get projectRoot(): string {
    return this.#context.projectRoot;
  }

  /** The reconciled run bundle attempts publish into; `undefined` outside a ready execute run. */
  get bundle(): ExecutionBundle | undefined {
    return this.#bundle;
  }

  onTestEnd(test: TestCase): void {
    const collection = this.#collection;
    if (!collection) return;
    const projectName = test.parent.project()?.name;
    if (projectName === undefined) return;
    const setup = collection.dependencyProjects.has(projectName);
    const teardown = collection.teardownProjects.has(projectName);
    if (setup || teardown) {
      this.#graphTests.set(test.id, { test, projectName, setup, teardown });
    }
  }

  /** Writes the final transport status; a returned status fails the Playwright run. */
  onEnd(
    result: FullResult,
    run: { publicationDiagnostics: readonly Diagnostic[]; globalErrors: readonly string[] },
  ): { status: FullResult["status"] } | undefined {
    const context = this.#context;
    if (context.mode === "collect") {
      try {
        if (this.#error) throw this.#error;
        if (!this.#collection) {
          throw new Error("framelia reporter: collection metadata was not captured.");
        }
        writeCollectionManifest(context, this.#collection.manifest);
        writeTransportStatus(context, "completed");
        return undefined;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        writeTransportStatus(context, "error", [
          { code: "FRAMELIA_COLLECTION_FAILED", message: failure.message },
        ]);
        return { status: "failed" };
      }
    }

    const blocked =
      !this.#ready || this.#error !== undefined || run.publicationDiagnostics.length > 0;
    const diagnostics = [
      ...(this.#error
        ? [{ code: "FRAMELIA_EXECUTION_RECONCILIATION", message: this.#error.message }]
        : []),
      ...run.publicationDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    ];
    writeTransportStatus(context, blocked ? "blocked" : "completed", diagnostics, {
      resultStatus: result.status,
      ...this.#graphFailures(),
      globalErrors: [...run.globalErrors],
    });
    return blocked ? { status: "failed" } : undefined;
  }

  /** Setup/teardown tests whose final outcome is a failure -- retries collapse into one entry
   *  per test, and a test that passed on retry ("flaky") is not a failure. */
  #graphFailures(): { setupFailures: string[]; teardownFailures: string[] } {
    const setupFailures = new Set<string>();
    const teardownFailures = new Set<string>();
    for (const { test, projectName, setup, teardown } of this.#graphTests.values()) {
      if (test.outcome() !== "unexpected") continue;
      const identity = `${projectName}:${test.title}`;
      if (setup) setupFailures.add(identity);
      if (teardown) teardownFailures.add(identity);
    }
    return { setupFailures: [...setupFailures], teardownFailures: [...teardownFailures] };
  }
}
