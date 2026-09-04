import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

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
    ["contract", ["create", "suggest-masks"]],
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
    const port = await reservePort();
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
    } finally {
      // Unconditional: a failed assertion above would otherwise leave the
      // dashboard holding its port and keep the runner from exiting.
      child.kill("SIGTERM");
    }
    const { code } = await exited;
    expect(code).toBe(0);
  }, 30_000);
});
