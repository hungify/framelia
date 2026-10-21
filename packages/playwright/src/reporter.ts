import type { CaptureDefaults, DashboardEvent } from "@framelia/contracts";
import {
  RUN_PLAN_FRAGMENT_FORMAT_VERSION,
  type CasePlan,
  type Diagnostic,
  type RunContext,
  type RunShard,
  type SourceIdentity,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, portableErrorMessage, sanitizePortableValue } from "@framelia/verify";
import {
  buildDirectRunPlan,
  cacheSelectedRunProjection,
  computeExecutionGraphDigest,
  computeCaseId,
  finalizeRunRecord,
  finalizeShardedRun,
  freezeRunPlan,
  publishAttempt,
  publishPlanFragment,
  publishShardCompletion,
  readCasePlans,
  readRunPlan,
  startRunRecord,
} from "@framelia/verify/run-bundle";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
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
  /** The run-bundle `runId`; falls back to the `FRAMELIA_RUN_ID` environment variable, then
   *  to a fresh `nanoid()` per Playwright invocation. Set it (or `FRAMELIA_RUN_ID`) to one
   *  value per CI run when sharding: every `--shard` then contributes to one shared run, which
   *  is finalized once all shards completed. It must be unique per run -- a published run is
   *  immutable, so reusing an ID (e.g. a CI re-run) is refused. */
  runId?: string;
  /** Known source/build identity (e.g. a CI-resolved commit SHA) folded into every case
   *  plan's `source` field. framelia/#77's own text calls for case identity to cover
   *  "known source/build identity" but doesn't specify how a Reporter should obtain
   *  one -- establishing real CI/build provenance (git plumbing, dirty-tree detection)
   *  is out of this ticket's scope, so it's left as an explicit, optional caller-supplied
   *  value; omitted entirely (`{}`) when not given. */
  source?: SourceIdentity;
}

/** Environment fallback for the reporter's `runId` option; shared by every shard of one run. */
const RUN_ID_ENV = "FRAMELIA_RUN_ID";

// @framelia/dashboard-server is an optional peer dependency (it owns the hono/@hono/node-server
// HTTP runtime) -- a consumer who only calls toMatchFigma/toMatchPage/toMatchUrl and never
// registers this Reporter should never be forced to install it. `typeof import(...)` is a
// type-only reference and costs nothing at runtime; the actual module load is deferred to
// loadDashboardServer() below, which only runs once a Reporter is constructed and used.
type DashboardServerModule = typeof import("@framelia/dashboard-server");
type ReporterStoreInstance = InstanceType<DashboardServerModule["ReporterStore"]>;
type DashboardServer = Awaited<ReturnType<DashboardServerModule["startDashboardServer"]>>;
type SelectedRunProjection = ReturnType<DashboardServerModule["projectSelectedRun"]>;

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
    /** Set for one shard of a sharded run sharing its run ID (see #initializeRunBundle). */
    shard?: RunShard;
  };
  /** Mirrors `#ready`/`#pending` for the run-bundle path -- independent of dashboard
   *  startup so a failed/missing @framelia/dashboard-server peer dependency can never
   *  prevent durable run-bundle recording (see onBegin's own doc comment). */
  #runBundleReady?: Promise<void>;
  #runBundlePending: Promise<void>[] = [];
  #publicationDiagnostics: Diagnostic[] = [];
  #selectedListeners = new Set<(event: DashboardEvent) => void>();
  /** The dashboard's selected-run projection, recomputed only when the run bundle changes
   *  (a published attempt or finalization) and shared by snapshot() and files(). */
  #selectedProjection?: () => SelectedRunProjection;
  #selectedSequence = 0;
  #runContext?: RunContext;
  #transportCollection?: TransportCollection;
  #transportError?: Error;
  #transportReady = false;
  /** Setup/teardown-project tests seen in execute mode, keyed by test id so retries collapse
   *  into one entry; whether each failed is decided once, at onEnd, from `test.outcome()`
   *  -- a setup test that failed and then passed on retry is flaky, not a setup failure. */
  #graphTests = new Map<
    string,
    { test: TestCase; projectName: string; setup: boolean; teardown: boolean }
  >();
  #globalErrors: string[] = [];
  /** Direct mode: more than one configured project, so contractId-keyed low-level evidence
   *  carries the project name (see report-projection.ts's `EvidenceKeyOptions`). */
  #multiProject = false;
  /** Direct mode: how many collected tests carry a `framelia.contract` annotation. */
  #contractTestCount = 0;
  /** Direct mode: why run-bundle recording could not start, when it couldn't. */
  #recordingError?: string;

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
    this.#multiProject = (config.projects?.length ?? 0) > 1;
    const tests = suite.allTests();
    this.#contractTestCount = tests.filter(
      (test) => readContractRegistration(test) !== undefined,
    ).length;
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
        // A mixed suite shows both: the selected run's annotated cases, plus whatever
        // low-level matcher results the ephemeral store holds (never part of the run).
        source: {
          snapshot: async () => {
            await this.#runBundleReady;
            const bundle = this.#runBundle;
            const lowLevel = store.snapshot();
            const projection = bundle && this.#readableProjection(mod, bundle);
            if (!projection) return lowLevel;
            const selected = projection.run;
            if (lowLevel.contracts.length === 0) return selected;
            const contracts = [...selected.contracts, ...lowLevel.contracts];
            const summary = mod.summarize(contracts);
            return { ...selected, contracts, summary, status: mod.overallStatus(summary) };
          },
          files: async () => {
            await this.#runBundleReady;
            const bundle = this.#runBundle;
            const lowLevel = store.files();
            const projection = bundle && this.#readableProjection(mod, bundle);
            if (!projection) return lowLevel;
            const selected = projection.files;
            return new Map([...lowLevel, ...selected]);
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
    // A failure here no longer just logs: onEnd fails the run when annotated tests exist
    // but could not be recorded (see #recordingError).
    this.#runBundleReady = policyPromise
      .then((policy) => this.#initializeRunBundle(tests, policy, config))
      .catch((error: unknown) => {
        this.#recordingError = `run-bundle recording is disabled for this run: ${errorMessage(error)}`;
        console.error(`framelia reporter: ${this.#recordingError}`);
      });
  }

  #projectSelectedRun(
    mod: DashboardServerModule,
    bundle: { root: string; runId: string },
  ): SelectedRunProjection {
    this.#selectedProjection ??= cacheSelectedRunProjection(bundle.root, bundle.runId, (run) =>
      mod.projectSelectedRun(bundle.root, run),
    );
    return this.#selectedProjection();
  }

  /** A shard's shared run has no readable plan until every shard completed; until then the
   *  dashboard shows only low-level results. */
  #readableProjection(
    mod: DashboardServerModule,
    bundle: { root: string; runId: string },
  ): SelectedRunProjection | undefined {
    try {
      return this.#projectSelectedRun(mod, bundle);
    } catch (error) {
      if ((error as { code?: unknown }).code === "RUN_BUNDLE_SHARDS_PENDING") return undefined;
      throw error;
    }
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
   * Freezes only the contract tests visible in a direct Playwright invocation. Unlike
   * coordinated `framelia check`, that path has no independently authored full matrix;
   * collected tests are exact selected membership but not proof of completeness.
   * Direct plans therefore remain `selection.mode: "subset"`, leave `requiredCases`
   * empty, and rely on independently signed gate requirements for completeness. A run
   * with zero annotated tests is not published; one with annotated tests but no
   * resolvable policy digest (no `framelia.config.*`) throws, failing the run in onEnd.
   *
   * Only cases the contract actually applies to are planned: a contract's own `projects`
   * (else the policy's visual `playwright.projects`) excludes every other project, the
   * same membership rule `resolveContractProjectMatrix` uses -- those tests skip
   * themselves at runtime and must not appear as planned-but-unrun cases.
   *
   * A sharded invocation (`--shard`) sees only its own shard's tests. With a shared run ID
   * (the `runId` option or `FRAMELIA_RUN_ID`), it publishes its cases as that run's plan
   * fragment instead of freezing a plan -- even an empty one, so the run can tell a shard
   * without contract tests from one that never ran -- and onEnd finalizes the run once every
   * shard completed (see @framelia/verify's sharded-run.ts). Without a shared run ID it
   * records a per-shard bundle whose runId carries a `-shard-<current>-of-<total>` suffix.
   */
  async #initializeRunBundle(
    tests: TestCase[],
    policy: ResolvedProjectPolicy,
    config: FullConfig,
  ): Promise<void> {
    const contractTests = tests.filter((test) => readContractRegistration(test) !== undefined);
    const sharedRunId = this.#options.runId ?? (process.env[RUN_ID_ENV]?.trim() || undefined);
    const shard = config.shard ?? undefined;
    const sharedShard = shard && sharedRunId !== undefined ? shard : undefined;
    if (contractTests.length === 0 && !(sharedShard && policy.policyDigest)) return;
    if (!policy.policyDigest) {
      throw new Error(
        `${contractTests.length} framelia.contract test(s) were collected, but no framelia.config.* was found for project root ${this.#projectRoot}. Run \`framelia init\` there (or point the reporter's \`projectRoot\` option at the initialized project) so the run can be recorded.`,
      );
    }
    const baseRunId = sharedRunId ?? nanoid();
    const runId =
      shard && !sharedShard ? `${baseRunId}-shard-${shard.current}-of-${shard.total}` : baseRunId;
    if (shard && !sharedShard) {
      console.warn(
        `framelia reporter: sharded run (shard ${shard.current}/${shard.total}) without a shared run ID -- recording per-shard run bundle "${runId}". To record every shard into one run, set ${RUN_ID_ENV} (or the reporter's runId option) to one value per CI run for all shards, e.g. ${RUN_ID_ENV}=\${GITHUB_RUN_ID}-\${GITHUB_RUN_ATTEMPT}.`,
      );
    }

    const results = (
      await Promise.all(
        contractTests.map((test) =>
          buildCasePlanForTest(test, {
            projectRoot: this.#projectRoot,
            runId,
            policy,
            source: this.#options.source ?? {},
          }),
        ),
      )
    ).filter((result) => {
      const applicable = result.casePlan.contract.authored.projects ?? policy.playwright?.projects;
      return applicable === undefined || applicable.includes(result.casePlan.project.name);
    });
    const casePlans = results.map((result) => result.casePlan);

    if (sharedShard) {
      await publishPlanFragment(this.#projectRoot, {
        formatVersion: RUN_PLAN_FRAGMENT_FORMAT_VERSION,
        kind: "framelia.run-plan-fragment",
        runId,
        shard: { current: sharedShard.current, total: sharedShard.total },
        policyDigest: policy.policyDigest,
        retryAcceptance: policy.retryAcceptance,
        createdAt: new Date().toISOString(),
        casePlans,
      });
    } else {
      if (results.length === 0) return;
      const plan = buildDirectRunPlan({
        runId,
        policyDigest: policy.policyDigest,
        retryAcceptance: policy.retryAcceptance,
        casePlans,
      });
      freezeRunPlan(this.#projectRoot, plan, casePlans);
      startRunRecord(this.#projectRoot, plan, new Date().toISOString());
    }

    this.#runBundle = {
      root: this.#projectRoot,
      runId,
      cases: new Map(results.map((result) => [result.testId, { casePlan: result.casePlan }])),
      retryAcceptance: policy.retryAcceptance,
      ...(sharedShard ? { shard: { current: sharedShard.current, total: sharedShard.total } } : {}),
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const transportCollection = this.#transportCollection;
    if (transportCollection) {
      const projectName = test.parent.project()?.name;
      if (projectName !== undefined) {
        const setup = transportCollection.dependencyProjects.has(projectName);
        const teardown = transportCollection.teardownProjects.has(projectName);
        if (setup || teardown) {
          this.#graphTests.set(test.id, { test, projectName, setup, teardown });
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
          { multiProject: this.#multiProject },
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
        await publishAttempt(
          bundle.root,
          bundle.runId,
          attemptRecord,
          files,
          bundle.shard ? { shard: bundle.shard } : {},
        );
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

  /** Keeps each global error's own (portable) text -- the execute lifecycle summary and a
   *  direct run's final record both carry it, so a reader sees what actually went wrong. */
  onError(error: TestError): void {
    const message = sanitizePortableValue(
      (error.message ?? error.value ?? "").trim(),
      this.#projectRoot,
    ).trim();
    this.#globalErrors.push(message || "Playwright reported a global execution error.");
  }

  /** Execute mode: setup/teardown tests whose final outcome is a failure -- retries collapse
   *  into one entry per test, and a test that passed on retry ("flaky") is not a failure. */
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

  /**
   * One shard of a shared sharded run: records its completion marker, then finalizes the run
   * when it is the last shard to complete (on this machine or after the shards' run
   * directories were collected) -- otherwise leaves the run open for the remaining shards.
   */
  async #completeShard(
    bundle: { root: string; runId: string },
    shard: RunShard,
    result: FullResult,
  ): Promise<void> {
    await publishShardCompletion(bundle.root, bundle.runId, shard, {
      resultStatus: result.status,
      globalErrors: this.#globalErrors,
      diagnostics: this.#publicationDiagnostics,
    });
    const outcome = await finalizeShardedRun(bundle.root, bundle.runId);
    if (outcome.state === "finalized") {
      console.log(
        `framelia reporter: every shard of run ${bundle.runId} completed -- finalized the run (${outcome.record.status}).`,
      );
    } else if (outcome.state === "waiting") {
      console.log(
        `framelia reporter: shard ${shard.current}/${shard.total} of run ${bundle.runId} completed; waiting for ${outcome.missing
          .map((missing) => `shard ${missing.current}/${missing.total}`)
          .join(
            ", ",
          )}. The last shard to finish finalizes the run. Shards on other machines: collect every shard's .framelia/runs/<run> directory into one project root and run \`framelia runs finalize --run ${bundle.runId}\`.`,
      );
    } else if (outcome.state === "empty") {
      console.log(
        `framelia reporter: no shard of run ${bundle.runId} collected a framelia.contract case; nothing was recorded.`,
      );
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
        ...this.#graphFailures(),
        globalErrors: this.#globalErrors,
      });
      return blocked ? { status: "failed" } : undefined;
    }

    await this.#ready?.catch(() => undefined);
    await Promise.all(this.#pending);
    await this.#runBundleReady?.catch(() => undefined);
    await Promise.all(this.#runBundlePending);
    // A direct run's recording failures fail the Playwright run itself (never just a log
    // line a green CI job would hide), mirroring execute mode's blocked lifecycle above.
    const recordingFailures: string[] = [];
    if (this.#contractTestCount > 0 && this.#recordingError) {
      recordingFailures.push(this.#recordingError);
    }
    if (this.#publicationDiagnostics.length > 0) {
      recordingFailures.push(
        `${this.#publicationDiagnostics.length} attempt publication(s) failed; the run bundle is sealed "error".`,
      );
    }
    if (this.#runBundle?.shard) {
      try {
        await this.#completeShard(this.#runBundle, this.#runBundle.shard, result);
      } catch (error: unknown) {
        recordingFailures.push(
          `failed to complete shard ${this.#runBundle.shard.current}/${this.#runBundle.shard.total} of run ${this.#runBundle.runId} -- durable run-bundle recording is incomplete: ${errorMessage(error)}`,
        );
      }
    } else if (this.#runBundle) {
      try {
        await finalizeRunRecord(this.#runBundle.root, this.#runBundle.runId, {
          retryAcceptance: this.#runBundle.retryAcceptance,
          diagnostics: [
            ...this.#publicationDiagnostics,
            ...this.#globalErrors.map((message) => ({
              code: "execution-global-error",
              stage: "execution",
              message,
            })),
          ],
          resultStatus: result.status,
        });
      } catch (error: unknown) {
        recordingFailures.push(
          `failed to finalize run bundle for run ${this.#runBundle.runId} -- durable run-bundle recording is incomplete: ${errorMessage(error)}`,
        );
      }
    }
    for (const failure of recordingFailures) console.error(`framelia reporter: ${failure}`);

    this.#store?.finish();
    const server = await this.#serverPromise?.catch(() => undefined);
    await server?.close();
    return recordingFailures.length > 0 ? { status: "failed" } : undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
