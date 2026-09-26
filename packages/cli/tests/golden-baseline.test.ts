import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createSelectedRun } from "./selected-run-fixture.ts";

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

/**
 * A port the OS just handed out and released, rather than a random guess that
 * can already belong to another process. `--port 0` is rejected by the CLI's
 * positive-port check, so the dashboard cannot bind an ephemeral port itself.
 */
async function reservePort(): Promise<number> {
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port assigned");
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("golden baseline: version", () => {
  it("prints the version to stdout with exit 0 for both --version and -V", () => {
    for (const flag of ["--version", "-V"]) {
      const result = run([flag]);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe("golden baseline: nested route map with no subcommand", () => {
  it.each([
    ["contract", ["create", "list", "refresh-baseline", "suggest-masks"]],
    ["baseline", ["promote"]],
  ])("prints route-map help to STDOUT and exits 0 for bare `%s`", (route, subroutes) => {
    const result = run([route]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`framelia ${route} `);
    for (const subroute of subroutes) expect(result.stdout).toContain(subroute);
  });
});

describe("golden baseline: unrecognized top-level token falls through to the default command", () => {
  it("does NOT report 'unknown command' -- it is treated as an extra argument to the default `dashboard` command", () => {
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
    const result = run(["status", "--", "--project-root"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Too many arguments");
    expect(result.stderr).toContain('"--"');
  });
});

describe("golden baseline: alias routes (fetch-gold / diff)", () => {
  it("`fetch-gold` alias surfaces the same required-flag error as `capture`", () => {
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
  it.each([
    ["open", ["open"], "Expected input for flag --run"],
    ["auth", ["auth"], "Expected input for flag --url"],
    [
      "contract suggest-masks",
      ["contract", "suggest-masks"],
      "Expected input for flag --target-url",
    ],
    ["baseline promote", ["baseline", "promote"], "Expected input for flag --key"],
  ])("`%s` fails fast on a missing required flag, exit 2, stderr only", (_label, args, message) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });
});

describe("golden baseline: trusted-input read failures are usage errors (exit 2)", () => {
  it("`done-gate` on a missing protected requirements file", () => {
    const result = run([
      "done-gate",
      "--run",
      "run-selected",
      "--requirements",
      "does-not-exist.json",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      executionState: "incomplete",
      exitCode: 2,
      issues: [
        {
          code: "SIGNED_REQUIREMENTS_UNREADABLE",
          message: "The protected signed requirements envelope could not be read.",
        },
      ],
    });
    expect(result.stdout).not.toContain("does-not-exist.json");
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
  it("dry-runs without writes, then applies and repeats idempotently", () => {
    const projectRoot = tempDir("framelia-init-");

    const dryRun = run(["init", "--project-root", projectRoot, "--dry-run"]);
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      kind: "framelia.init-outcome",
      dryRun: true,
      executionState: "completed",
    });
    expect(fs.readdirSync(projectRoot)).toEqual([]);

    const first = run(["init", "--project-root", projectRoot]);
    expect(first.status).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      kind: "framelia.init-outcome",
      dryRun: false,
    });
    const configBytes = fs.readFileSync(path.join(projectRoot, "framelia.config.ts"));

    const second = run(["init", "--project-root", projectRoot, "--force"]);
    expect(second.status).toBe(0);
    expect(fs.readFileSync(path.join(projectRoot, "framelia.config.ts"))).toEqual(configBytes);
  });
});

describe("contract create JSON lifecycle", () => {
  it("fails immediately with one structured noninteractive missing-input result and no project writes", () => {
    const projectRoot = tempDir("framelia-contract-missing-");
    const initialized = run(["init", "--project-root", projectRoot]);
    expect(initialized.status).toBe(0);
    const before = fs.readdirSync(projectRoot, { recursive: true }).map(String).toSorted();

    const result = run(["contract", "create", "--project-root", projectRoot]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: "framelia.contract-create-outcome",
      executionState: "error",
      authored: false,
      diagnostics: [
        {
          code: "CONTRACT_AUTHORING_FAILED",
          message: expect.stringContaining("MISSING_INPUT"),
        },
      ],
    });
    expect(fs.readdirSync(projectRoot, { recursive: true }).map(String).toSorted()).toEqual(before);
  });
});

describe("golden baseline: dashboard bare default command", () => {
  it("prints a ready banner on stderr and shuts down cleanly on SIGTERM within a bounded timeout", async () => {
    const port = await reservePort();
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-dashboard-golden-"));
    fs.writeFileSync(path.join(projectRoot, "framelia.config.mjs"), "export default {};\n");
    await createSelectedRun(projectRoot);
    const child = spawn(
      process.execPath,
      [binPath, "dashboard", "--run", "run-selected", "--port", String(port), "--no-open"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: projectRoot,
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
      expect(stderr).toMatch(/➜ {2}Local: {3}http:\/\/localhost:\d+\//);
      expect(stderr).toContain("Network: use --host to expose");
      if (!stdout.trim()) {
        await new Promise<void>((resolve) => {
          child.stdout.once("data", () => resolve());
        });
      }
      const readiness = JSON.parse(stdout.trim()) as {
        kind: string;
        command: string;
        selectedRun: { runId: string };
        address: { local: string[] };
      };
      expect(readiness).toMatchObject({
        kind: "framelia.open-ready",
        command: "dashboard",
        selectedRun: { runId: "run-selected" },
        address: { local: [expect.stringMatching(/^http:\/\/localhost:\d+\/$/)] },
      });
    } finally {
      // Unconditional: a failed assertion above would otherwise leave the
      // dashboard holding its port and keep the runner from exiting.
      child.kill("SIGTERM");
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
    const { code } = await exited;
    expect(code).toBe(0);
  }, 30_000);
});
