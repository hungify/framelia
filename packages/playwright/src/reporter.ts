import * as fs from "node:fs";
import * as path from "node:path";

import type { VerificationArtifact } from "@framelia/contracts";
import { writeVerificationArtifact } from "@framelia/verify";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import { contractNameFor, finalizeTestEnd, sanitizeTestId } from "./report-projection.ts";

export interface FrameliaReporterOptions {
  /** Project root `.framelia/` evidence writes under; defaults to the Playwright config's rootDir. */
  projectRoot?: string;
  hostname?: string;
  port?: number;
  /** Forwarded to startUIServer; mainly for tests -- production use should rely on the default. */
  clientRoot?: string;
  /**
   * Project's `maxMaskedAreaRatio` default (from framelia.config.ts). Written into every
   * run-meta.json so `done-gate` -- which reads this same project default via
   * contractToDoneGate, not the matcher's per-call capture option -- doesn't spuriously fail
   * a correctly-masked, passing run over a value it never wrote.
   */
  maxMaskedAreaRatio?: number;
}

// @framelia/ui-server is an optional peer dependency (it owns the hono/@hono/node-server
// HTTP runtime) -- a consumer who only calls toMatchFigma/toMatchPage/toMatchUrl and never
// registers this Reporter should never be forced to install it. `typeof import(...)` is a
// type-only reference and costs nothing at runtime; the actual module load is deferred to
// loadUIServer() below, which only runs once a Reporter is constructed and used.
type UIServerModule = typeof import("@framelia/ui-server");
type ReporterStoreInstance = InstanceType<UIServerModule["ReporterStore"]>;
type UIServer = Awaited<ReturnType<UIServerModule["startUIServer"]>>;

let uiServerModulePromise: Promise<UIServerModule> | undefined;

function loadUIServer(): Promise<UIServerModule> {
  uiServerModulePromise ??= import("@framelia/ui-server").catch((error: unknown) => {
    throw new Error(
      'FrameliaReporter requires the optional peer dependency "@framelia/ui-server" -- ' +
        "install it in your project to use the reporter.",
      { cause: error },
    );
  });
  return uiServerModulePromise;
}

/**
 * Playwright Reporter: drives framelia's live UI during a
 * matcher-driven test run, and persists a schema-v4 VerificationArtifact per
 * test afterward so `done-gate`/`report`/`open` keep functioning. Register it
 * in `playwright.config.ts`'s `reporter` array.
 */
export default class FrameliaReporter implements Reporter {
  readonly #options: FrameliaReporterOptions;
  #store?: ReporterStoreInstance;
  #serverPromise?: Promise<UIServer>;
  #projectRoot = process.cwd();
  #artifacts: VerificationArtifact[] = [];
  /** Loading @framelia/ui-server and seeding #store is async; buffers onTestEnd
   * calls that land before it resolves so no result is silently dropped (KTD13's Reporter
   * only gets one whole-test-result callback per test -- there is no second chance). */
  #ready?: Promise<void>;
  #pending: Promise<void>[] = [];

  constructor(options: FrameliaReporterOptions = {}) {
    this.#options = options;
  }

  /** Resolves once the UI server is reachable; `undefined` if it failed to start. */
  uiUrl(): Promise<string | undefined> {
    return (this.#ready ?? Promise.resolve()).then(
      () => this.#serverPromise?.then((server) => server.url).catch(() => undefined) ?? undefined,
    );
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.#projectRoot = this.#options.projectRoot ?? config.rootDir ?? process.cwd();
    const tests = suite.allTests();
    const ready = loadUIServer().then((mod) => {
      const store = new mod.ReporterStore(
        tests.map((test) => ({
          id: sanitizeTestId(test),
          name: contractNameFor(test),
          tags: test.tags,
        })),
      );
      this.#store = store;
      this.#serverPromise = mod.startUIServer({
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
        .then((server) => console.log(`framelia UI: ${server.url}`))
        .catch((error: unknown) => console.error(`framelia UI failed to start: ${String(error)}`));
      return undefined;
    });
    this.#ready = ready;
    ready.catch((error: unknown) => console.error(String(error)));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const record = (): void => {
      if (!this.#store) return;
      const projection = finalizeTestEnd(
        test,
        this.#projectRoot,
        result,
        this.#options.maxMaskedAreaRatio,
      );
      this.#store.recordResult(projection.uiId, projection.uiResult, projection.files);
      this.#artifacts.push(...projection.artifacts);
    };
    if (this.#store) {
      record();
      return;
    }
    this.#pending.push((this.#ready ?? Promise.resolve()).then(record).catch(() => {}));
  }

  async onEnd(_result: FullResult): Promise<void> {
    await this.#ready?.catch(() => undefined);
    await Promise.all(this.#pending);
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
