import * as fs from "node:fs";
import * as path from "node:path";

import type { CaptureDefaults, VerificationArtifact } from "@framelia/contracts";
import {
  RUN_PLAN_FORMAT_VERSION,
  runPlanSchema,
  type SourceIdentity,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, writeVerificationArtifact } from "@framelia/verify";
import {
  finalizeRunRecord,
  freezeRunPlan,
  publishAttempt,
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
  readContractBinding,
} from "./run-bundle-projection.ts";

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
 * Playwright Reporter: drives framelia's live dashboard during a
 * matcher-driven test run, and persists a VerificationArtifact per test
 * afterward so `done-gate`/`report`/`open` keep functioning. Register it
 * in `playwright.config.ts`'s `reporter` array.
 */
export default class FrameliaReporter implements Reporter {
  readonly #options: FrameliaReporterOptions;
  #store?: ReporterStoreInstance;
  #serverPromise?: Promise<DashboardServer>;
  #projectRoot = process.cwd();
  #artifacts: VerificationArtifact[] = [];
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
    cases: Map<string, { caseId: string; casePlanDigest: `sha256:${string}` }>;
    retryAcceptance: RetryAcceptancePolicy;
  };
  /** Mirrors `#ready`/`#pending` for the run-bundle path -- independent of dashboard
   *  startup so a failed/missing @framelia/dashboard-server peer dependency can never
   *  prevent durable run-bundle recording (see onBegin's own doc comment). */
  #runBundleReady?: Promise<void>;
  #runBundlePending: Promise<void>[] = [];

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
        tests.map((test) => ({
          id: sanitizeTestId(test),
          name: contractNameFor(test),
          tags: test.tags,
        })),
      );
      this.#store = store;
      this.#serverPromise = mod.startDashboardServer({
        source: {
          snapshot: () => store.snapshot(),
          files: () => store.files(),
          subscribe: (l) => store.subscribe(l),
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

  /**
   * Freezes a `RunPlan` (and starts its `RunRecord`) covering every `framelia.contract`-
   * annotated test this suite collected. `contractAnnotatedTests IS the "available"/
   * "selected" set for this run` -- full contract-discovery-vs-collection reconciliation
   * (what a real subset/`--test-list` selection would narrow `selectedCases` down from)
   * is #79 (WP6)'s collection-transport job, not this Reporter's: with only Playwright's
   * own collected suite visible here, every collected case IS what was required and
   * selected for this particular invocation, so `selection.mode` is always `"all"` and
   * `requiredCases`/`selectedCases`/`availableCases` are identical. A run with zero
   * annotated tests has nothing to freeze (`runPlanSchema` requires at least one case)
   * and is silently skipped -- an ordinary matcher-only suite never gets a run bundle.
   * Likewise skipped when the project has no resolvable `policyDigest` (no
   * `framelia.config.*` found): case-plan/run-plan digests need one real policy digest to
   * anchor to, matching `resolveContractProjectMatrix`'s own `PROJECT_POLICY_INCOMPLETE`
   * precedent for the same underlying requirement.
   */
  async #initializeRunBundle(tests: TestCase[], policy: ResolvedProjectPolicy): Promise<void> {
    if (!policy.policyDigest) return;
    const contractTests = tests.filter((test) => readContractBinding(test) !== undefined);
    if (contractTests.length === 0) return;

    const specDigestCache = new Map<string, `sha256:${string}`>();
    const results = await Promise.all(
      contractTests.map((test) =>
        buildCasePlanForTest(test, {
          projectRoot: this.#projectRoot,
          policyDigest: policy.policyDigest!,
          source: this.#options.source ?? {},
          specDigestCache,
        }),
      ),
    );

    const planned = results.map((result) => ({
      caseId: result.caseId,
      casePlanDigest: canonicalJsonDigest(result.casePlan),
    }));
    const contracts = [...new Set(results.map((result) => result.casePlan.contract.id))].toSorted();
    const runId = this.#options.runId ?? nanoid();
    const plan = runPlanSchema.parse({
      formatVersion: RUN_PLAN_FORMAT_VERSION,
      kind: "framelia.run-plan",
      runId,
      policyDigest: policy.policyDigest,
      selection: { mode: "all", contracts },
      availableCases: planned,
      requiredCases: planned,
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
      cases: new Map(
        results.map((result) => [
          result.testId,
          { caseId: result.caseId, casePlanDigest: canonicalJsonDigest(result.casePlan) },
        ]),
      ),
      retryAcceptance: policy.retryAcceptance,
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const record = (): void => {
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
      this.#artifacts.push(...projection.artifacts);
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
          caseEntry.caseId,
          caseEntry.casePlanDigest,
        );
        await publishAttempt(bundle.root, bundle.runId, attemptRecord, files);
      } catch (error: unknown) {
        console.error(
          `framelia reporter: failed to publish run-bundle attempt for ${sanitizeTestId(test)}: ${String(error)}`,
        );
      }
    };
    this.#runBundlePending.push(
      (this.#runBundleReady ?? Promise.resolve()).then(publishRunBundleAttempt),
    );
  }

  async onEnd(_result: FullResult): Promise<void> {
    await this.#ready?.catch(() => undefined);
    await Promise.all(this.#pending);

    // Finalization happens before -- and independent of -- dashboard shutdown/artifact
    // writing below: "child exit alone is not successful finalization" only holds if
    // finalizeRunRecord() actually runs regardless of whatever the old path does next.
    await this.#runBundleReady?.catch(() => undefined);
    await Promise.all(this.#runBundlePending);
    if (this.#runBundle) {
      try {
        await finalizeRunRecord(this.#runBundle.root, this.#runBundle.runId, {
          retryAcceptance: this.#runBundle.retryAcceptance,
        });
      } catch (error: unknown) {
        console.error(
          `framelia reporter: failed to finalize run bundle for run ${this.#runBundle.runId} -- durable run-bundle recording is incomplete: ${String(error)}`,
        );
      }
    }

    this.#store?.finish();
    for (const artifact of this.#artifacts) {
      try {
        // contracts[0].outDir is relative (VISUAL_ARTIFACT_DIR_PATTERN requires it);
        // resolve it against projectRoot for the actual filesystem write.
        const outDir = path.join(this.#projectRoot, artifact.request.contracts[0]!.outDir);
        fs.mkdirSync(outDir, { recursive: true });
        writeVerificationArtifact(path.join(outDir, "visual-verification.json"), artifact);
      } catch (error: unknown) {
        console.error(
          `framelia reporter: failed to write verification artifact for ${artifact.request.contracts[0]?.id ?? "unknown"}: ${String(error)}`,
        );
      }
    }
    const server = await this.#serverPromise?.catch(() => undefined);
    await server?.close();
  }
}
