import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * Phase 0 baseline (see the CLI v2 rewrite plan): golden stdout/stderr/exit-code
 * fixtures captured against the CURRENT Commander-based CLI, before any Stricli
 * code exists. These are compatibility fixtures, not tests of "what's ideal" --
 * a rewritten command must reproduce this behavior byte-for-byte for
 * machine-readable output/exit codes, and must preserve output mode/key content/
 * stream routing for human-facing text (see the plan's "Output compatibility is
 * contract-level" section). Do not "fix" a captured quirk here without updating
 * the rewrite plan first -- this file exists to make behavior changes visible,
 * not to silently encode them.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binPath = path.join(packageRoot, "bin", "framelia.js");

function run(args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    ...options,
  });
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("golden baseline: version", () => {
  it("prints the version to stdout with exit 0 for both --version and -V", () => {
    // Documented stream change: the old CLI's blanket `configureOutput` redirected ALL
    // of Commander's normal stdout writes (including --version) to stderr; Stricli's
    // `version` integration writes directly to stdout (verified live), which is also
    // the conventional stream for `--version` across most CLIs. Exit code is unchanged.
    for (const flag of ["--version", "-V"]) {
      const result = run([flag]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

/**
 * Phase 2 update (Stricli application shell): the assertions below were captured
 * against the OLD Commander CLI. Now that `cli.ts`/`commands/*.ts` are Stricli
 * declarations, each assertion falls into one of two buckets:
 *
 * - Scanner-level behavior (duplicate/missing/unknown flags, `--` handling, route-map
 *   defaults) runs before any command body executes, so it is NOT stub-dependent --
 *   these assertions are updated in place below to Stricli's actual (real, verified,
 *   not guessed) diagnostic wording and stream routing. Per the rewrite plan's output
 *   compatibility contract, diagnostic wording may change if documented and exit
 *   code/stream routing is preserved; that is what happened here, verified against the
 *   live `tsx src/cli.ts ...` output, not assumed.
 * - Business-logic behavior (anything that requires a real `internal/*.ts`
 *   implementation) is `.skip`ped with a `TODO(Phase N)` naming the phase that
 *   replaces the stub -- see `internal/not-implemented.ts`.
 */

describe("golden baseline: nested route map with no subcommand", () => {
  it.each([
    ["contract", ["create", "suggest-masks"]],
    ["baseline", ["promote"]],
  ])("prints route-map help to STDOUT and exits 0 for bare `%s`", (route, subroutes) => {
    // Documented change from Commander's stderr/exit-2: Stricli's `defaultForRouteMap`
    // help behavior (see cli.ts's `help({...})` integration) treats a bare route map as
    // ordinary successful help output, not a usage error. Verified live, not assumed.
    const result = run([route]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`framelia ${route} `);
    for (const subroute of subroutes) expect(result.stdout).toContain(subroute);
  });
});

describe("golden baseline: unrecognized top-level token falls through to the default command", () => {
  it("does NOT report 'unknown command' -- it is treated as an extra argument to the default `dashboard` command", () => {
    // Still true under Stricli's root route map (`defaultCommand: "dashboard"`): an
    // unrecognized leading token is not routed as "unknown command", it overflows as an
    // unexpected positional argument to `dashboard`. Only the diagnostic's wording
    // changed (Stricli's own scanner message, not a hand-written Commander one).
    const result = run(["totally-unknown-command"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Too many arguments");
    expect(result.stderr).toContain("totally-unknown-command");
  });
});

describe("golden baseline: `--` argument termination", () => {
  it("an option consumes a literal `--` as its value when `--` appears where a value is expected", () => {
    const result = run(["status", "--project-root", "--"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { projectRoot: string };
    expect(parsed.projectRoot.endsWith(path.sep + "--")).toBe(true);
  });

  it("a bare `--` with no recognized flags waiting for it is an excess-argument scanner error", () => {
    // Documented wording change: Stricli treats the `--` token itself (not the
    // `--project-root` that follows it) as the excess argument, since
    // `allowArgumentEscapeSequence` is left at its default `false`. Exit code and
    // stderr-only routing are unchanged.
    const result = run(["status", "--", "--project-root"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Too many arguments");
    expect(result.stderr).toContain('"--"');
  });
});

describe("golden baseline: alias routes (fetch-gold / diff)", () => {
  it("`fetch-gold` alias surfaces the same required-flag error as `capture`", () => {
    // Documented wording change: Stricli's scanner reports each missing required flag
    // as its own "Expected input for flag --x" line and does not echo a full usage
    // summary alongside a scanner error (unlike Commander's showHelpAfterError()).
    const result = run(["fetch-gold"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Expected input for flag --file-key");
    expect(result.stderr).toContain("Expected input for flag --node-id");
    expect(result.stderr).toContain("Expected input for flag --out");
  });

  it("`diff` alias surfaces the same required-flag error as `compare`", () => {
    const result = run(["diff"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Expected input for flag --baseline");
    expect(result.stderr).toContain("Expected input for flag --actual");
  });
});

describe("golden baseline: compare is result-producing (exit 0/1, never a usage error for a checked failure)", () => {
  it("returns pass: false as JSON on stdout with exit 1 when files are missing/mismatched", () => {
    const result = run(["compare", "--baseline", "missing-a.png", "--actual", "missing-b.png"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as { pass: boolean };
    expect(parsed.pass).toBe(false);
  });
});

describe("golden baseline: fast-failing required-flag routes", () => {
  // Documented wording change from Commander's `required option 'X' not specified`;
  // exit 2 and stderr-only routing are unchanged (verified live for every route below).
  it.each([
    ["open", ["open"], "--artifact"],
    ["report", ["report"], "--artifact"],
    ["done-gate", ["done-gate"], "--artifact"],
    ["auth", ["auth"], "--url"],
    ["contract suggest-masks", ["contract", "suggest-masks"], "--target-url"],
    ["baseline promote", ["baseline", "promote"], "--key"],
  ])("`%s` fails fast on a missing required flag, exit 2, stderr only", (_label, args, flag) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`Expected input for flag ${flag}`);
  });
});

describe("golden baseline: file-read failures surface as plain usage-boundary errors (exit 2)", () => {
  it("`done-gate` on a missing artifact file", () => {
    const result = run(["done-gate", "--artifact", "does-not-exist.json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Cannot read JSON does-not-exist.json");
    expect(result.stderr).toContain("ENOENT");
  });

  it("`report` on a missing artifact file", () => {
    const outputDirectory = tempDir("framelia-report-out-");
    const result = run([
      "report",
      "--artifact",
      "does-not-exist.json",
      "--output",
      outputDirectory,
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    // Documented, narrow divergence (same category as Phase 4's `compare` PNG-read
    // message): the old CLI passed the raw relative `--artifact` string straight into
    // `readVerificationArtifact`, which embedded it verbatim in this error. The new
    // `internal/dashboard-report.ts` resolves the path via the injected `runtime.cwd()`
    // first (required so tests can inject a fake cwd -- see the plan's Central Seams
    // section), so the same error now shows the resolved absolute path instead.
    expect(result.stderr).toContain(
      `Cannot read verification artifact ${path.resolve(process.cwd(), "does-not-exist.json")}`,
    );
    expect(result.stderr).toContain("ENOENT");
  });
});

describe("golden baseline: auth URL validation happens before config is loaded", () => {
  it("rejects a non-http(s) URL with a specific message, exit 2", () => {
    const result = run(["auth", "--url", "not-a-url"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Auth URL must use http:// or https://.\n");
  });
});

describe("golden baseline: init lifecycle", () => {
  it("scaffolds a project, refuses to overwrite, then honors --force", () => {
    const projectRoot = tempDir("framelia-init-");

    const first = run(["init", "--project-root", projectRoot]);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toContain("Initialize Framelia");
    expect(first.stdout).toContain("Project ready");
    expect(fs.existsSync(path.join(projectRoot, "framelia.config.ts"))).toBe(true);

    const second = run(["init", "--project-root", projectRoot]);
    expect(second.status).toBe(2);
    expect(second.stderr).toContain("Refusing to overwrite existing file");
    expect(second.stderr).toContain("Pass --force to replace it");

    const third = run(["init", "--project-root", projectRoot, "--force"]);
    expect(third.status).toBe(0);
    expect(third.stdout).toContain("Project ready");
  });
});

describe("golden baseline: dashboard bare default command", () => {
  it("prints a ready banner on stderr and shuts down cleanly on SIGTERM within a bounded timeout", async () => {
    // Regression coverage for the plan's own Phase-0 requirement: the bare
    // default command must never be exercised without a bounded shutdown --
    // there is no injectable DashboardHost/shutdown-event seam on today's
    // Commander implementation, so a bounded external timeout + SIGTERM is
    // the only safe way to capture this fixture prior to Phase 9.
    // A random high port avoids colliding with a port left bound by a
    // previous (or concurrent) test run; the dashboard itself also retries
    // the next port on EADDRINUSE, so this is a fixture of "some port", not
    // a specific one.
    const port = 40_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(
      process.execPath,
      [binPath, "dashboard", "--port", String(port), "--no-open"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.on("exit", (code, signal) => resolve({ code, signal }));
      },
    );

    // "Network: use --host to expose" is the last line of the ready banner (see
    // dashboard-output.ts's `ready()`) -- for this exact invocation (no --host, so
    // hostname defaults to "localhost", which always takes resolveServerUrls's
    // loopback branch and never populates networkUrls), it deterministically prints
    // every time, and waiting for it (not just the earlier "FRAMELIA" line) ensures
    // the full banner -- including the "Local:" line asserted on below -- has already
    // arrived by the time this resolves.
    //
    // The 22s bound (vs. the 30s `it(...)` timeout below) leaves headroom for the
    // `SIGTERM`-triggered shutdown assertions to run afterward. Readiness itself is
    // fast (the banner reports single-digit ms after a ~0.5s cold Node start), so a
    // timeout here means the banner never *matched*, not that it never arrived: this
    // gate and the assertions below compare plain text, which requires the child to
    // emit no SGR escapes -- see `vitest.config.ts`'s `NO_COLOR` pin, without which
    // picocolors colors the banner on any `CI=true` runner and this waits out the
    // full bound with the banner sitting in `stderr`. Do not "fix" a timeout here by
    // raising the bound (a previous 15s -> 22s bump chased exactly that phantom).
    // If the child exits/errors before printing the banner, reject immediately
    // (with its captured output) instead of waiting out the rest of the timeout.
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `dashboard did not become ready in time\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        );
      }, 22_000);
      const settleFromExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        clearTimeout(timer);
        reject(
          new Error(
            `dashboard exited before becoming ready (code=${code}, signal=${signal})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        );
      };
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", settleFromExit);
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.includes("Network: use --host to expose")) {
          clearTimeout(timer);
          child.off("exit", settleFromExit);
          resolve();
        }
      });
    });

    try {
      await ready;
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
    expect(stderr).toMatch(/➜ {2}Local: {3}http:\/\/localhost:\d+\//);
    expect(stderr).toContain("Network: use --host to expose");

    child.kill("SIGTERM");
    const { code } = await exited;
    // The dashboard's own SIGTERM handler performs a graceful shutdown and
    // calls process.exit(0) itself -- it is not killed by the signal.
    expect(code).toBe(0);
  }, 30_000);
});
