import type { CaptureDefaults, DashboardEvent } from "@framelia/contracts";
import {
  RUN_PLAN_FORMAT_VERSION,
  runPlanSchema,
  type CasePlan,
  type Diagnostic,
  type RunContext,
  type SourceIdentity,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, portableErrorMessage } from "@framelia/verify";
import {
  computeExecutionGraphDigest,
  computeCaseId,
  finalizeRunRecord,
  freezeRunPlan,
  publishAttempt,
  readCasePlans,
  readRunPlan,
  readSelectedRun,
  startRunRecord,
} from "@framelia/verify/run-bundle";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { nanoid } from "nanoid";

import {
  resolveProjectPolicy,
  type ResolvedProjectPolicy,
  type RetryAcceptancePolicy,
} from "./project-policy.ts";
import { contractNameFor, finalizeTestEnd, sanitizeTestId } from "./report-projection.ts";
import {
  buildAttemptRecord,
  buildCasePlanForTest,
  readContractRegistration,
} from "./run-bundle-projection.ts";
import { readRunContext, writeCollectionManifest, writeTransportStatus } from "./run-context.ts";
import { buildTransportCollection, type TransportCollection } from "./transport-collection.ts";

export interface FrameliaReporterOptions {
  /** Project root `.framelia/` evidence writes under; defaults to the Playwright config's rootDir. */
  projectRoot?: string;
  hostname?: string;
  port?: number;
  /** Forwarded to startDashboardServer; mainly for tests -- production use should rely on the default. */
  clientRoot?: string;
  /** Overrides the generated run-bundle `runId`; mainly for tests -- production use should
   *  rely on the default (a fresh `nanoid()` per Playwright invocation). */
  runId?: string;
  /** Known source/build identity (e.g. a CI-resolved commit SHA) folded into every case
   *  plan's `source` field. framelia/#77's own text calls for case identity to cover
   *  "known source/build identity" but doesn't specify how a Reporter should obtain
   *  one -- establishing real CI/build provenance (git plumbing, dirty-tree detection)
   *  is out of this ticket's scope, so it's left as an explicit, optional caller-supplied
   *  value; omitted entirely (`{}`) when not given. */
  source?: SourceIdentity;
}

// @framelia/dashboard-server is an optional peer dependency (it owns the hono/@hono/node-server
// HTTP runtime) -- a consumer who only calls toMatchFigma/toMatchPage/toMatchUrl and never
// registers this Reporter should never be forced to install it. `typeof import(...)` is a
// type-only reference and costs nothing at runtime; the actual module load is deferred to
// loadDashboardServer() below, which only runs once a Reporter is constructed and used.
type DashboardServerModule = typeof import("@framelia/dashboard-server");
type ReporterStoreInstance = InstanceType<DashboardServerModule["ReporterStore"]>;
type DashboardServer = Awaited<ReturnType<DashboardServerModule["startDashboardServer"]>>;

let dashboardServerModulePromise: Promise<DashboardServerModule> | undefined;

function loadDashboardServer(): Promise<DashboardServerModule> {
  dashboardServerModulePromise ??= import("@framelia/dashboard-server").catch((error: unknown) => {
    // Reset the memo on failure so a transient/environment issue (not just a genuinely
    // missing peer dep) doesn't wedge every later call in this process into the same
    // rejected promise forever -- the next loadDashboardServer() call gets a fresh attempt.
    dashboardServerModulePromise = undefined;
    throw new Error(
      'FrameliaReporter requires the optional peer dependency "@framelia/dashboard-server" -- ' +
        "install it in your project to use the reporter.",
      { cause: error },
    );
  });
  return dashboardServerModulePromise;
}

/**
 * Playwright Reporter: records annotated contract tests into one durable run bundle and
 * projects that selected bundle to the dashboard. Unannotated low-level matchers retain
 * their ephemeral live ReporterStore view.
 */
export default class FrameliaReporter implements Reporter {
  readonly #options: FrameliaReporterOptions;
  #store?: ReporterStoreInstance;
  #serverPromise?: Promise<DashboardServer>;
  #projectRoot = process.cwd();
  #captureDefaults: CaptureDefaults = {};
  /** Loading @framelia/dashboard-server and seeding #store is async; buffers onTestEnd
   * calls that land before it resolves so no result is silently dropped -- Playwright's
   * Reporter only gets one whole-test-result callback per test, so there is no second
   * chance to record it. */
  #ready?: Promise<void>;
  #pending: Promise<void>[] = [];
  /** Set once `#initializeRunBundle` has frozen a run plan and started its run record;
   *  stays `undefined` for a run with zero `framelia.contract`-annotated tests, or when
   *  freezing failed (logged, never thrown out of onBegin). */
  #runBundle?: {
    root: string;
    runId: string;
    cases: Map<string, { casePlan: CasePlan }>;
    retryAcceptance: RetryAcceptancePolicy;
  };
  /** Mirrors `#ready`/`#pending` for the run-bundle path -- independent of dashboard
   *  startup so a failed/missing @framelia/dashboard-server peer dependency can never
   *  prevent durable run-bundle recording (see onBegin's own doc comment). */
  #runBundleReady?: Promise<void>;
  #runBundlePending: Promise<void>[] = [];
  #publicationDiagnostics: Diagnostic[] = [];
  #selectedListeners = new Set<(event: DashboardEvent) => void>();
  #selectedSequence = 0;
  #runContext?: RunContext;
  #transportCollection?: TransportCollection;
  #transportError?: Error;
  #transportReady = false;
  #setupFailures: string[] = [];
  #teardownFailures: string[] = [];
  #globalErrors: string[] = [];

  constructor(options: FrameliaReporterOptions = {}) {
    this.#options = options;
  }

  /** Resolves once the dashboard server is reachable; `undefined` if it failed to start. */
  dashboardUrl(): Promise<string | undefined> {
    return (this.#ready ?? Promise.resolve()).then(
      () => this.#serverPromise?.then((server) => server.url).catch(() => undefined) ?? undefined,
    );
  }

  onBegin(config: FullConfig, suite: Suite): void {
    let runContext: RunContext | undefined;
    try {
      runContext = readRunContext();
    } catch (error) {
      console.error(String(error));
      return;
    }
    if (runContext) {
      this.#runContext = runContext;
      this.#projectRoot = runContext.projectRoot;
      try {
        this.#transportCollection = buildTransportCollection(suite, runContext);
        if (runContext.mode === "execute") {
          writeCollectionManifest(runContext, this.#transportCollection.manifest);
          this.#reconcileExecution();
          writeTransportStatus(runContext, "ready");
          this.#transportReady = true;
        }
      } catch (error) {
        this.#transportError = error instanceof Error ? error : new Error(String(error));
        if (runContext.mode === "execute") {
          writeTransportStatus(runContext, "blocked", [
            { code: "FRAMELIA_EXECUTION_RECONCILIATION", message: this.#transportError.message },
          ]);
        }
      }
      return;
    }
    this.#projectRoot = this.#options.projectRoot ?? config.rootDir ?? process.cwd();
    const tests = suite.allTests();
    const policyPromise = resolveProjectPolicy({
      cwd: this.#projectRoot,
      projectRoot: this.#projectRoot,
      allowUninitialized: true,
    });

    const ready = Promise.all([loadDashboardServer(), policyPromise]).then(([mod, policy]) => {
      this.#captureDefaults = policy.capture;
      const store = new mod.ReporterStore(
        tests
          .filter((test) => !readContractRegistration(test))
          .map((test) => ({
            id: sanitizeTestId(test),
            name: contractNameFor(test),
            tags: test.tags,
          })),
      );
      this.#store = store;
      this.#serverPromise = mod.startDashboardServer({
        source: {
          snapshot: async () => {
            await this.#runBundleReady;
            const bundle = this.#runBundle;
            return bundle
              ? mod.projectSelectedRun(bundle.root, readSelectedRun(bundle.root, bundle.runId)).run
              : store.snapshot();
          },
          files: async () => {
            await this.#runBundleReady;
            const bundle = this.#runBundle;
            return bundle
              ? mod.projectSelectedRun(bundle.root, readSelectedRun(bundle.root, bundle.runId))
                  .files
              : store.files();
          },
          subscribe: (listener) => {
            const unsubscribeStore = store.subscribe((event) =>
              listener({
                ...event,
                runId: this.#runBundle?.runId ?? event.runId,
              }),
            );
            this.#selectedListeners.add(listener);
            return () => {
              unsubscribeStore();
              this.#selectedListeners.delete(listener);
            };
          },
        },
        hostname: this.#options.hostname,
        port: this.#options.port,
        clientRoot: this.#options.clientRoot,
      });
      this.#serverPromise
        .then((server) => console.log(`framelia dashboard: ${server.url}`))
        .catch((error: unknown) =>
          console.error(`framelia dashboard failed to start: ${String(error)}`),
        );
      return undefined;
    });
    this.#ready = ready;
    ready.catch((error: unknown) => console.error(String(error)));

    // Deliberately depends on `policyPromise` alone, never on `loadDashboardServer()` --
    // a run whose dashboard peer dependency is missing/broken must still get durable
    // run-bundle recording (framelia/#77: "Decouple recording from optional dashboard
    // startup" / "Dashboard failure cannot prevent durable recording").
    this.#runBundleReady = policyPromise
      .then((policy) => this.#initializeRunBundle(tests, policy))
      .catch((error: unknown) =>
        console.error(
          `framelia reporter: run-bundle publication disabled for this run: ${String(error)}`,
        ),
      );
  }

  #reconcileExecution(): void {
    const context = this.#runContext;
    const collection = this.#transportCollection;
    if (!context || context.mode !== "execute" || !collection) {
      throw new Error("framelia reporter: execute reconciliation has no captured collection.");
    }
    const plan = readRunPlan(context.projectRoot, context.runId);
    if (plan.policyDigest !== context.policyDigest) {
      throw new Error("framelia reporter: frozen plan policy does not match execute context.");
    }
    const graphDigest = computeExecutionGraphDigest(collection.manifest);
    if (graphDigest !== plan.executionGraphDigest) {
      throw new Error(
        `framelia reporter: execution graph changed after collection (${graphDigest} != ${plan.executionGraphDigest}).`,
      );
    }
    const casePlans = readCasePlans(context.projectRoot, context.runId);
    if (collection.visualTests.length !== plan.selectedCases.length) {
      throw new Error(
        `framelia reporter: execution collected ${collection.visualTests.length} visual cases, but the frozen plan selected ${plan.selectedCases.length}.`,
      );
    }
    const selectedById = new Map(plan.selectedCases.map((entry) => [entry.caseId, entry]));
    const cases = new Map<string, { casePlan: CasePlan }>();
    const seen = new Set<string>();
    for (const { test, collected } of collection.visualTests) {
      const caseId = computeCaseId({
        contractId: collected.binding.contractId,
        projectName: collected.project,
        repeatIndex: collected.repeatIndex,
      });
      if (seen.has(caseId)) {
        throw new Error(
          `framelia reporter: duplicate execute binding for selected case ${caseId}.`,
        );
      }
      seen.add(caseId);
      const selected = selectedById.get(caseId);
      const casePlan = casePlans.get(caseId);
      if (!selected || !casePlan) {
        throw new Error(
          `framelia reporter: execute case ${caseId} is absent from the frozen plan.`,
        );
      }
      if (
        canonicalJsonDigest(casePlan) !== selected.casePlanDigest ||
        canonicalJsonDigest(casePlan.binding) !== canonicalJsonDigest(collected.binding) ||
        casePlan.specFile !== collected.specFile ||
        casePlan.specFileDigest !== collected.specFileDigest ||
        casePlan.project.name !== collected.project ||
        casePlan.project.runtimeDigest !== collected.projectRuntimeDigest ||
        casePlan.repeatIndex !== collected.repeatIndex ||
        JSON.stringify(casePlan.registration.titlePath) !== JSON.stringify(collected.testTitlePath)
      ) {
        throw new Error(
          `framelia reporter: execute case ${caseId} was remapped after its plan was frozen.`,
        );
      }
      cases.set(test.id, { casePlan });
    }
    if (seen.size !== selectedById.size) {
      throw new Error(
        "framelia reporter: one or more frozen selected cases are missing at execute.",
      );
    }
    this.#runBundle = {
      root: context.projectRoot,
      runId: context.runId,
      cases,
      retryAcceptance: plan.retryAcceptance,
    };
  }

  /**
   * Freezes only the contract tests visible in this direct Playwright invocation.
   * Until WP6 supplies an independently frozen discovery matrix, collected tests are
   * exact selected membership but never proof of the full required matrix. Direct
   * reporter plans therefore use `selection.mode: "subset"`, leave `requiredCases`
   * empty, and rely on the independently signed gate requirements for completeness.
   * A run with zero annotated tests or no resolvable policy digest is not published.
   */
  async #initializeRunBundle(tests: TestCase[], policy: ResolvedProjectPolicy): Promise<void> {
    if (!policy.policyDigest) return;
    const contractTests = tests.filter((test) => readContractRegistration(test) !== undefined);
    if (contractTests.length === 0) return;
    const runId = this.#options.runId ?? nanoid();

    const results = await Promise.all(
      contractTests.map((test) =>
        buildCasePlanForTest(test, {
          projectRoot: this.#projectRoot,
          runId,
          policy,
          source: this.#options.source ?? {},
        }),
      ),
    );

    const planned = results.map((result) => ({
      caseId: result.caseId,
      casePlanDigest: canonicalJsonDigest(result.casePlan),
    }));
    const contracts = [...new Set(results.map((result) => result.casePlan.contract.id))].toSorted();
    const availableMatrix = [
      ...new Map(
        results.map((result) => {
          const casePlan = result.casePlan;
          return [
            `${casePlan.contract.id}\u0000${casePlan.project.name}`,
            {
              contractId: casePlan.contract.id,
              contractFile: casePlan.contract.file,
              contractDigest: casePlan.contract.digest,
              project: casePlan.project.name,
              required: casePlan.contract.authored.required,
            },
          ] as const;
        }),
      ).values(),
    ];
    const plan = runPlanSchema.parse({
      formatVersion: RUN_PLAN_FORMAT_VERSION,
      kind: "framelia.run-plan",
      runId,
      policyDigest: policy.policyDigest,
      executionGraphDigest: canonicalJsonDigest({
        directCases: results.map((result) => ({
          caseId: result.caseId,
          projectRuntimeDigest: result.casePlan.project.runtimeDigest,
          specFileDigest: result.casePlan.specFileDigest,
          titlePath: result.casePlan.registration.titlePath,
        })),
      }),
      retryAcceptance: policy.retryAcceptance,
      selection: { mode: "subset", contracts },
      availableMatrix,
      requiredMatrix: [],
      availableCases: planned,
      requiredCases: [],
      selectedCases: planned,
    });

    freezeRunPlan(
      this.#projectRoot,
      plan,
      results.map((result) => result.casePlan),
    );
    startRunRecord(this.#projectRoot, plan, new Date().toISOString());

    this.#runBundle = {
      root: this.#projectRoot,
      runId,
      cases: new Map(results.map((result) => [result.testId, { casePlan: result.casePlan }])),
      retryAcceptance: policy.retryAcceptance,
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const transportCollection = this.#transportCollection;
    if (transportCollection) {
      const projectName = test.parent.project()?.name;
      if (projectName !== undefined && result.status !== "passed" && result.status !== "skipped") {
        const identity = `${projectName}:${test.title}`;
        if (transportCollection.dependencyProjects.has(projectName)) {
          this.#setupFailures.push(identity);
        }
        if (transportCollection.teardownProjects.has(projectName)) {
          this.#teardownFailures.push(identity);
        }
      }
    } else {
      const record = (): void => {
        if (readContractRegistration(test)) return;
        if (!this.#store) return;
        const projection = finalizeTestEnd(
          test,
          this.#projectRoot,
          result,
          this.#captureDefaults.maxMaskedAreaRatio,
        );
        this.#store.recordResult(
          projection.dashboardId,
          projection.dashboardResult,
          projection.files,
        );
      };
      if (this.#store) {
        record();
      } else {
        this.#pending.push(
          (this.#ready ?? Promise.resolve())
            .then(record)
            .catch((error: unknown) =>
              console.error(
                `framelia reporter: failed to record result for ${sanitizeTestId(test)}: ${String(error)}`,
              ),
            ),
        );
      }
    }

    // Independent of the dashboard-facing `record()` above: a failure on either side can
    // never prevent the other from running (see onBegin's own doc comment). `publishAttempt`
    // is async (its own lock acquisition/release can await), so every publish -- not just
    // ones that land before `#runBundle` is ready -- is tracked in `#runBundlePending` for
    // `onEnd` to await before finalizing.
    const publishRunBundleAttempt = async (): Promise<void> => {
      const bundle = this.#runBundle;
      const caseEntry = bundle?.cases.get(test.id);
      if (!bundle || !caseEntry) return;
      try {
        const { record: attemptRecord, files } = buildAttemptRecord(
          result,
          bundle.runId,
          caseEntry.casePlan,
          bundle.root,
        );
        await publishAttempt(bundle.root, bundle.runId, attemptRecord, files);
        const event: DashboardEvent = {
          sequence: ++this.#selectedSequence,
          runId: bundle.runId,
          timestamp: new Date().toISOString(),
          contractId: caseEntry.casePlan.caseId,
          phase: "complete",
          status:
            attemptRecord.executionState === "completed"
              ? attemptRecord.visualVerdict === "passed"
                ? "passed"
                : "failed"
              : "blocked",
        };
        for (const listener of this.#selectedListeners) listener(event);
      } catch (error: unknown) {
        const diagnostic: Diagnostic = {
          code: "attempt-publication-failed",
          stage: "publication",
          message: `Attempt publication failed for "${caseEntry.casePlan.caseId}": ${portableErrorMessage(error, bundle.root)}`,
        };
        this.#publicationDiagnostics.push(diagnostic);
        console.error(`framelia reporter: ${diagnostic.message}`);
      }
    };
    this.#runBundlePending.push(
      (this.#runBundleReady ?? Promise.resolve()).then(publishRunBundleAttempt),
    );
  }

  onError(): void {
    if (this.#runContext?.mode === "execute") {
      this.#globalErrors.push("Playwright reported a global execution error.");
    }
  }

  async onEnd(result: FullResult): Promise<void | { status: FullResult["status"] }> {
    const runContext = this.#runContext;
    if (runContext) {
      await Promise.all(this.#runBundlePending);
      if (runContext.mode === "collect") {
        try {
          if (this.#transportError) throw this.#transportError;
          if (!this.#transportCollection) {
            throw new Error("framelia reporter: collection metadata was not captured.");
          }
          writeCollectionManifest(runContext, this.#transportCollection.manifest);
          writeTransportStatus(runContext, "completed");
          return;
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          writeTransportStatus(runContext, "error", [
            { code: "FRAMELIA_COLLECTION_FAILED", message: failure.message },
          ]);
          return { status: "failed" };
        }
      }

      const blocked =
        !this.#transportReady ||
        this.#transportError !== undefined ||
        this.#publicationDiagnostics.length > 0;
      const diagnostics = [
        ...(this.#transportError
          ? [{ code: "FRAMELIA_EXECUTION_RECONCILIATION", message: this.#transportError.message }]
          : []),
        ...this.#publicationDiagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
        })),
      ];
      writeTransportStatus(runContext, blocked ? "blocked" : "completed", diagnostics, {
        resultStatus: result.status,
        setupFailures: this.#setupFailures,
        teardownFailures: this.#teardownFailures,
        globalErrors: this.#globalErrors,
      });
      return blocked ? { status: "failed" } : undefined;
    }

    await this.#ready?.catch(() => undefined);
    await Promise.all(this.#pending);
    await this.#runBundleReady?.catch(() => undefined);
    await Promise.all(this.#runBundlePending);
    if (this.#runBundle) {
      try {
        await finalizeRunRecord(this.#runBundle.root, this.#runBundle.runId, {
          retryAcceptance: this.#runBundle.retryAcceptance,
          diagnostics: this.#publicationDiagnostics,
        });
      } catch (error: unknown) {
        console.error(
          `framelia reporter: failed to finalize run bundle for run ${this.#runBundle.runId} -- durable run-bundle recording is incomplete: ${String(error)}`,
        );
      }
    }

    this.#store?.finish();
    const server = await this.#serverPromise?.catch(() => undefined);
    await server?.close();
  }
}
