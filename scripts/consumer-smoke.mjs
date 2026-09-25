import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import * as net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "pack-dir": { type: "string" },
    "registry-version": { type: "string" },
    "package-manager": { type: "string", default: "npm" },
    "playwright-version": { type: "string", default: "1.61.1" },
    "install-browser": { type: "boolean", default: false },
    "collection-only": { type: "boolean", default: false },
  },
});
assert.ok(
  Boolean(values["pack-dir"]) !== Boolean(values["registry-version"]),
  "Supply exactly one of --pack-dir or --registry-version",
);
const packageManager = values["package-manager"];
assert.ok(["npm", "pnpm"].includes(packageManager), "Expected --package-manager npm or pnpm");
const repo = fileURLToPath(new URL("../", import.meta.url));
const fixtures = path.join(repo, "scripts/consumer-smoke");
const releasePackages = new Map();
for (const directory of ["contracts", "verify", "dashboard-server", "playwright", "cli"]) {
  const manifest = JSON.parse(readFileSync(path.join(repo, "packages", directory, "package.json")));
  let spec = values["registry-version"];
  if (values["pack-dir"]) {
    const archives = path.resolve(values["pack-dir"], directory);
    const names = readdirSync(archives).filter((name) => name.endsWith(".tgz"));
    assert.equal(names.length, 1, `Expected exactly one packed ${manifest.name} in ${archives}`);
    spec = `file:${path.join(archives, names[0])}`;
  }
  releasePackages.set(manifest.name, spec);
}

// A workspace condition or loader inherited from the developer shell would make
// this a source smoke, not a test of what an ordinary npm consumer receives.
const env = { ...process.env, CI: "1", FORCE_COLOR: "0" };
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
delete env.NO_COLOR;
env.FIGMA_ACCESS_TOKEN = "";
env.FIGMA_TOKEN = "";

function run(command, args, cwd) {
  console.log(`[consumer smoke] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    const report = path.join(cwd, "playwright-report.json");
    if (existsSync(report)) process.stderr.write(readFileSync(report, "utf8"));
    throw (
      result.error ??
      new Error(`${command} exited ${result.status} (${result.signal ?? "no signal"})`)
    );
  }
  return result.stdout;
}

function runOutcome(command, args, cwd, expectedStatuses) {
  console.log(`[consumer smoke] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || !expectedStatuses.includes(result.status)) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw (
      result.error ??
      new Error(`${command} exited ${result.status} (${result.signal ?? "no signal"})`)
    );
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function reservePort() {
  const server = net.createServer();
  const listening = Promise.withResolvers();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const closed = Promise.withResolvers();
  server.close(closed.resolve);
  await closed.promise;
  return address.port;
}

async function runReadiness(command, args, cwd) {
  console.log(`[consumer smoke] ${command} ${args.join(" ")}`);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const exited = Promise.withResolvers();
  child.once("exit", (code, signal) => exited.resolve({ code, signal }));
  const ready = Promise.withResolvers();
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    ready.reject(new Error(`readiness timeout\nstdout:\n${stdout}\nstderr:\n${stderr}`));
  }, 30_000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    const firstLineEnd = stdout.indexOf("\n");
    if (firstLineEnd < 0) return;
    const line = stdout.slice(0, firstLineEnd).trim();
    try {
      const record = JSON.parse(line);
      clearTimeout(timer);
      ready.resolve(record);
    } catch (error) {
      clearTimeout(timer);
      ready.reject(
        new Error(`invalid readiness JSON on first stdout line: ${line}`, { cause: error }),
      );
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.once("error", (error) => {
    clearTimeout(timer);
    ready.reject(error);
  });
  child.once("exit", (code, signal) => {
    if (stdout.includes("\n")) return;
    clearTimeout(timer);
    ready.reject(new Error(`readiness process exited ${code ?? signal}\nstderr:\n${stderr}`));
  });
  const readiness = await ready.promise;
  child.kill("SIGTERM");
  const stopTimeout = Promise.withResolvers();
  const stopTimer = setTimeout(() => {
    child.kill("SIGKILL");
    stopTimeout.reject(new Error("readiness process did not stop after SIGTERM"));
  }, 10_000);
  const stopped = await Promise.race([exited.promise, stopTimeout.promise]);
  clearTimeout(stopTimer);
  if (stopped.code !== 0) {
    throw new Error(
      `readiness process exited ${stopped.code ?? stopped.signal}\nstderr:\n${stderr}`,
    );
  }
  const stdoutRecords = stdout.split("\n").filter((line) => line.trim());
  assert.equal(
    stdoutRecords.length,
    1,
    `readiness process must emit exactly one JSON stdout record, received ${stdoutRecords.length}`,
  );
  assert.deepEqual(JSON.parse(stdoutRecords[0]), readiness);
  return { readiness, stdout, stderr };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function collectedTitles(report) {
  return report.suites.flatMap(function visit(suite) {
    return [...suite.specs.map((spec) => spec.title), ...(suite.suites ?? []).flatMap(visit)];
  });
}

let browserInstalled = false;
for (const mode of ["module", "commonjs", "matcher-only"]) {
  const project = mkdtempSync(path.join(tmpdir(), `framelia-consumer-${packageManager}-${mode}-`));
  console.log(`[consumer smoke] ${packageManager}, Node ${process.version}, ${mode}: ${project}`);
  try {
    const standalone = mode === "matcher-only";
    const dependencies = {
      "@framelia/contracts": releasePackages.get("@framelia/contracts"),
      "@framelia/playwright": releasePackages.get("@framelia/playwright"),
      "@framelia/verify": releasePackages.get("@framelia/verify"),
      "@playwright/test": values["playwright-version"],
      typescript: "6.0.3",
      "@types/node": "26.0.1",
    };
    if (!standalone) dependencies.framelia = releasePackages.get("framelia");
    // Only substitute unpublished tarballs. Registry smoke must exercise the
    // published dependency graph without repairing it through overrides.
    const overrides = values["pack-dir"] ? { overrides: Object.fromEntries(releasePackages) } : {};
    writeJson(path.join(project, "package.json"), {
      name: "framelia-release-consumer",
      private: true,
      type: mode === "commonjs" ? "commonjs" : "module",
      devDependencies: dependencies,
      ...(packageManager === "npm" ? overrides : {}),
    });
    if (packageManager === "pnpm") {
      writeJson(path.join(project, "pnpm-workspace.yaml"), {
        packages: [],
        strictPeerDependencies: true,
        ...overrides,
      });
    }
    run(
      packageManager,
      packageManager === "npm"
        ? ["install", "--ignore-scripts", "--no-audit", "--no-fund"]
        : ["install", "--ignore-scripts", "--no-frozen-lockfile"],
      project,
    );
    cpSync(fixtures, project, { recursive: true });
    const require = createRequire(path.join(project, "package.json"));
    const playwright = require.resolve("@playwright/test/cli");
    run(process.execPath, ["imports.mjs"], project);

    if (!standalone) {
      const cli = path.join(project, "node_modules/framelia/bin/framelia.js");
      const playwrightConfigBeforeInit = readFileSync(
        path.join(project, "playwright.config.ts"),
        "utf8",
      );
      const dryInit = runOutcome(
        process.execPath,
        [cli, "init", "--project-root", project, "--dry-run"],
        project,
        [0],
      );
      assert.equal(JSON.parse(dryInit.stdout).dryRun, true);
      assert.equal(existsSync(path.join(project, "framelia.config.ts")), false);
      const initialized = runOutcome(
        process.execPath,
        [cli, "init", "--project-root", project],
        project,
        [0],
      );
      assert.equal(JSON.parse(initialized.stdout).kind, "framelia.init-outcome");
      assert.equal(
        readFileSync(path.join(project, "playwright.config.ts"), "utf8"),
        playwrightConfigBeforeInit,
        "init must preserve the consumer's existing reporter list byte-for-byte",
      );
      const frameliaConfigAfterInit = readFileSync(path.join(project, "framelia.config.ts"));
      run(process.execPath, [cli, "init", "--project-root", project, "--force"], project);
      assert.deepEqual(
        readFileSync(path.join(project, "framelia.config.ts")),
        frameliaConfigAfterInit,
        "repeat init must preserve existing Framelia configuration byte-for-byte",
      );
      const missingCreate = runOutcome(
        process.execPath,
        [cli, "contract", "create", "--project-root", project],
        project,
        [2],
      );
      assert.equal(missingCreate.stderr, "");
      assert.equal(
        JSON.parse(missingCreate.stdout).diagnostics[0].message.includes("MISSING_INPUT"),
        true,
      );
      assert.equal(existsSync(path.join(project, ".framelia", "contracts")), false);
      run(process.execPath, [cli, "status", "--project-root", project], project);
      writeFileSync(
        path.join(project, "config-probe.mjs"),
        'import assert from "node:assert/strict";\n' +
          'import { loadFrameliaConfig } from "framelia";\n' +
          "assert.equal((await loadFrameliaConfig(process.cwd())).configPath, `${process.cwd()}/framelia.config.ts`);\n",
      );
      run(process.execPath, ["config-probe.mjs"], project);
    }
    writeJson(path.join(project, "tsconfig.json"), {
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        types: ["node"],
      },
      include: standalone ? ["consumer.spec.ts", "consumer-types.ts"] : ["*.ts"],
    });
    run(
      process.execPath,
      [require.resolve("typescript/bin/tsc"), "--project", "tsconfig.json"],
      project,
    );

    // The matcher-only install deliberately lacks the optional dashboard peer.
    // Its ordinary runner collection must still work without loading a reporter.
    const reporterArgs = standalone ? ["--reporter=json"] : [];
    const listing = run(process.execPath, [playwright, "test", "--list", ...reporterArgs], project);
    const report = standalone
      ? JSON.parse(listing)
      : JSON.parse(readFileSync(path.join(project, "playwright-report.json"), "utf8"));
    assert.deepEqual(collectedTitles(report).toSorted(), [
      "consumer fixture factory",
      "side-effect registration",
      "typed entrypoint",
    ]);
    if (!standalone) {
      assert.equal(JSON.parse(readFileSync(path.join(project, "reporter-ready.json"))).status, 200);
      rmSync(path.join(project, "reporter-ready.json"));
    }

    if (!values["collection-only"] && !standalone) {
      if (values["install-browser"] && !browserInstalled) {
        run(
          process.execPath,
          [
            playwright,
            "install",
            ...(process.platform === "linux" ? ["--with-deps"] : []),
            "chromium",
          ],
          project,
        );
        browserInstalled = true;
      }
      run(process.execPath, [playwright, "test"], project);
      const results = JSON.parse(
        readFileSync(path.join(project, "playwright-report.json"), "utf8"),
      );
      assert.equal(results.stats.expected, 3);
      assert.equal(results.stats.unexpected, 0);
      assert.equal(results.stats.skipped, 0);
      assert.equal(results.errors.length, 0);
      assert.equal(JSON.parse(readFileSync(path.join(project, "reporter-ready.json"))).status, 200);
      const attachments = results.suites.flatMap((suite) =>
        suite.specs.flatMap((spec) =>
          spec.tests.flatMap((test) => test.results.flatMap((result) => result.attachments)),
        ),
      );
      const scores = attachments
        .filter((attachment) => attachment.name.endsWith("-framelia-score"))
        .map((attachment) => JSON.parse(Buffer.from(attachment.body, "base64").toString("utf8")));
      assert.equal(scores.filter((score) => score.pass).length, 3);
      assert.equal(scores.filter((score) => !score.pass).length, 2);

      writeFileSync(
        path.join(project, "playwright.check.config.ts"),
        [
          'import { defineConfig } from "@playwright/test";',
          "export default defineConfig({",
          '  testDir: ".",',
          "  workers: 1,",
          "  retries: 1,",
          "  repeatEach: 2,",
          '  reporter: [["./consumer-noisy-reporter.cjs"], ["@framelia/playwright/reporter"]],',
          "  use: { viewport: { width: 160, height: 120 } },",
          "  projects: [",
          '    { name: "setup", testMatch: "check.setup.ts", teardown: "cleanup" },',
          '    { name: "", testMatch: "check.spec.mjs", dependencies: ["setup"] },',
          '    { name: "named-visual", testMatch: "check.named.spec.mjs", dependencies: ["setup"] },',
          '    { name: "cleanup", testMatch: "check.cleanup.ts" },',
          "  ],",
          "});",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(project, "consumer-noisy-reporter.cjs"),
        'module.exports = class { onBegin() { console.log("consumer reporter noise"); } };\n',
      );
      writeFileSync(
        path.join(project, "check.setup.ts"),
        [
          'import { appendFileSync } from "node:fs";',
          'import { test } from "@playwright/test";',
          'test("seed consumer state", () => appendFileSync("check-lifecycle.log", "setup\\n"));',
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(project, "check.cleanup.ts"),
        [
          'import { appendFileSync } from "node:fs";',
          'import { test } from "@playwright/test";',
          'test("cleanup consumer state", () => appendFileSync("check-lifecycle.log", "cleanup\\n"));',
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(project, "check.spec.mjs"),
        [
          'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
          'import { defineFigmaTests } from "@framelia/playwright";',
          'import { test } from "@playwright/test";',
          "defineFigmaTests(test, {",
          '  contracts: [new URL("./contracts/check-pass.json", import.meta.url), new URL("./contracts/check-mismatch.json", import.meta.url)],',
          "  specUrl: new URL(import.meta.url),",
          '  projectRoot: new URL(".", import.meta.url).pathname,',
          "  async prepare({ page }, { target }) {",
          '    appendFileSync("check-executions.log", `${target.path}\\n`);',
          '    const matchingBackground = "linear-gradient(90deg,#123 50%,#abc 50%)";',
          "    let background = matchingBackground;",
          '    if (target.path === "/mismatch") {',
          '      const counterFile = "check-mismatch-attempts.txt";',
          '      const priorAttempts = existsSync(counterFile) ? Number(readFileSync(counterFile, "utf8")) : 0;',
          "      writeFileSync(counterFile, String(priorAttempts + 1));",
          '      if (priorAttempts === 0) background = "#f00";',
          "    }",
          '    await page.route(`http://framelia.test${target.path}`, route => route.fulfill({ contentType: "text/html", body: `<style>html,body{margin:0;width:160px;height:120px;background:${background}}</style>` }));',
          "    await page.goto(`http://framelia.test${target.path}`);",
          "  },",
          "});",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(project, "check.named.spec.mjs"),
        [
          'import { appendFileSync } from "node:fs";',
          'import { defineFigmaTests } from "@framelia/playwright";',
          'import { test } from "@playwright/test";',
          "defineFigmaTests(test, {",
          '  contracts: [new URL("./contracts/check-pass.json", import.meta.url)],',
          "  specUrl: new URL(import.meta.url),",
          '  projectRoot: new URL(".", import.meta.url).pathname,',
          "  async prepare({ page }, { target }) {",
          '    appendFileSync("check-executions.log", `named-visual:${target.path}\\n`);',
          '    const background = "linear-gradient(90deg,#123 50%,#abc 50%)";',
          '    await page.route(`http://framelia.test${target.path}`, route => route.fulfill({ contentType: "text/html", body: `<style>html,body{margin:0;width:160px;height:120px;background:${background}}</style>` }));',
          "    await page.goto(`http://framelia.test${target.path}`);",
          "  },",
          "});",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(project, "prepare-check.mjs"),
        [
          'import crypto from "node:crypto";',
          'import fs from "node:fs";',
          'import path from "node:path";',
          'import { chromium } from "@playwright/test";',
          'import { authoredContractSchema, baselineSnapshotSchema } from "@framelia/contracts/workflow";',
          'import { canonicalJsonDigest } from "@framelia/verify";',
          "const browser = await chromium.launch({ headless: true });",
          "const page = await browser.newPage({ viewport: { width: 160, height: 120 } });",
          'await page.route("http://framelia.test/pass", route => route.fulfill({ contentType: "text/html", body: "<style>html,body{margin:0;width:160px;height:120px;background:linear-gradient(90deg,#123 50%,#abc 50%)}</style>" }));',
          'await page.goto("http://framelia.test/pass");',
          'const imagePath = path.join(process.cwd(), "check-expected.png");',
          "await page.screenshot({ path: imagePath });",
          "await browser.close();",
          "const imageBytes = fs.readFileSync(imagePath);",
          'const imageDigest = `sha256:${crypto.createHash("sha256").update(imageBytes).digest("hex")}`;',
          'const snapshot = baselineSnapshotSchema.parse({ formatVersion: 1, kind: "framelia.baseline-snapshot", source: { kind: "figma", fileKey: "consumer", nodeId: "1:2" }, rendering: { viewport: { preset: "custom", width: 160, height: 120 }, deviceScaleFactor: 1 }, expected: { kind: "page", image: { path: "check-expected.png", digest: imageDigest, width: 160, height: 120 } } });',
          "const snapshotDigest = canonicalJsonDigest(snapshot);",
          'const snapshotDir = path.join(process.cwd(), ".framelia", "baselines", snapshotDigest.slice(7));',
          "fs.mkdirSync(snapshotDir, { recursive: true });",
          'fs.writeFileSync(path.join(snapshotDir, "snapshot.json"), JSON.stringify(snapshot));',
          'fs.mkdirSync(path.join(process.cwd(), "contracts"), { recursive: true });',
          'for (const [id, targetPath, required] of [["check.pass", "/pass", true], ["check.mismatch", "/mismatch", false]]) {',
          '  const contract = authoredContractSchema.parse({ formatVersion: 1, kind: "framelia.contract", id, name: "Shared visual name", revision: 1, target: { path: targetPath }, viewport: { preset: "custom", width: 160, height: 120 }, scope: { kind: "page", pageReason: "packed consumer check" }, baseline: { snapshotDigest }, required });',
          '  fs.writeFileSync(path.join(process.cwd(), "contracts", `${id === "check.pass" ? "check-pass" : "check-mismatch"}.json`), JSON.stringify(contract));',
          "}",
          "",
        ].join("\n"),
      );
      run(process.execPath, ["prepare-check.mjs"], project);
      writeFileSync(
        path.join(project, "framelia.config.ts"),
        [
          'import { defineConfig } from "framelia";',
          'export default defineConfig({ playwright: { config: "playwright.check.config.ts", projects: [""] }, contracts: ["contracts/check-*.json"] });',
          "",
        ].join("\n"),
      );
      const nestedCwd = path.join(project, "nested", "cwd");
      mkdirSync(nestedCwd, { recursive: true });
      const cli = path.join(project, "node_modules", "framelia", "bin", "framelia.js");
      const listed = runOutcome(
        process.execPath,
        [cli, "contract", "list", "--project-root", project],
        nestedCwd,
        [0],
      );
      const listOutcome = JSON.parse(listed.stdout);
      assert.deepEqual(
        listOutcome.contracts.map(({ contractId, status }) => ({ contractId, status })),
        [
          { contractId: "check.mismatch", status: "executable" },
          { contractId: "check.pass", status: "executable" },
        ],
      );
      const refreshContract = path.join(project, "contracts", "check-pass.json");
      const refreshPointerBefore = readFileSync(refreshContract);
      const refresh = runOutcome(
        process.execPath,
        [
          cli,
          "contract",
          "refresh-baseline",
          "--project-root",
          project,
          "--contract",
          "check.pass",
        ],
        nestedCwd,
        [2],
      );
      assert.equal(JSON.parse(refresh.stdout).diagnostics[0].code, "BASELINE_ACQUISITION_FAILED");
      assert.deepEqual(
        readFileSync(refreshContract),
        refreshPointerBefore,
        "failed refresh must preserve the prior contract pointer bytes",
      );
      rmSync(path.join(project, "check-lifecycle.log"), { force: true });
      rmSync(path.join(project, "check-executions.log"), { force: true });
      rmSync(path.join(project, "check-mismatch-attempts.txt"), { force: true });
      const passingCheck = runOutcome(process.execPath, [cli, "check", "--all"], nestedCwd, [0]);
      const passingOutcome = JSON.parse(passingCheck.stdout);
      assert.equal(passingOutcome.executionState, "completed");
      assert.equal(passingOutcome.visualVerdict, "passed");
      assert.equal(passingOutcome.selection.selectedCount, 2);
      assert.equal(passingOutcome.coverage.selectedCount, 2);
      assert.equal(passingOutcome.cases.length, 2);
      assert.ok(
        passingOutcome.cases.every(
          (selectedCase) =>
            selectedCase.chosenAttemptId &&
            selectedCase.attempts.some(
              (attempt) =>
                attempt.chosen &&
                attempt.evidence.expected.availability === "available" &&
                attempt.evidence.actual.availability === "available" &&
                attempt.evidence.score.availability === "available",
            ),
        ),
      );
      assert.match(passingCheck.stderr, /consumer reporter noise/);
      assert.doesNotMatch(passingCheck.stdout, /consumer reporter noise/);
      assert.match(readFileSync(path.join(project, "check-lifecycle.log"), "utf8"), /setup/);
      assert.match(readFileSync(path.join(project, "check-lifecycle.log"), "utf8"), /cleanup/);
      assert.deepEqual(
        readFileSync(path.join(project, "check-executions.log"), "utf8").trim().split("\n"),
        ["/pass", "/pass"],
      );

      rmSync(path.join(project, "check-lifecycle.log"), { force: true });
      rmSync(path.join(project, "check-executions.log"), { force: true });
      rmSync(path.join(project, "check-mismatch-attempts.txt"), { force: true });
      const mismatchCheck = runOutcome(
        process.execPath,
        [cli, "check", "--contract", "check.mismatch"],
        nestedCwd,
        [1],
      );
      const mismatchOutcome = JSON.parse(mismatchCheck.stdout);
      assert.equal(mismatchOutcome.executionState, "completed");
      assert.equal(mismatchOutcome.visualVerdict, "mismatched");
      assert.equal(mismatchOutcome.selection.selectedCount, 2);
      assert.notEqual(mismatchOutcome.runId, passingOutcome.runId);
      assert.deepEqual(mismatchOutcome.diagnostics, []);
      assert.equal(mismatchOutcome.coverage.selectedCount, 2);
      assert.equal(mismatchOutcome.cases.length, 2);
      assert.equal(mismatchOutcome.next.command, "framelia");
      assert.deepEqual(mismatchOutcome.next.argv.slice(0, 3), [
        "open",
        "--run",
        mismatchOutcome.runId,
      ]);
      assert.deepEqual(
        readFileSync(path.join(project, "check-executions.log"), "utf8").trim().split("\n"),
        ["/mismatch", "/mismatch", "/mismatch"],
      );
      assert.match(readFileSync(path.join(project, "check-lifecycle.log"), "utf8"), /setup/);
      assert.match(readFileSync(path.join(project, "check-lifecycle.log"), "utf8"), /cleanup/);
      const reportDirectory = path.join(project, `framelia-report-${mode}`);
      const exportedReport = runOutcome(
        process.execPath,
        [
          cli,
          "report",
          "--project-root",
          project,
          "--run",
          mismatchOutcome.runId,
          "--output",
          reportDirectory,
        ],
        nestedCwd,
        [1],
      );
      const reportOutcome = JSON.parse(exportedReport.stdout);
      assert.equal(reportOutcome.runId, mismatchOutcome.runId);
      assert.deepEqual(reportOutcome.cases, mismatchOutcome.cases);
      assert.equal(existsSync(path.join(reportDirectory, "index.html")), true);

      // eslint-disable-next-line no-await-in-loop -- package modes are intentionally isolated serial consumers
      const openPort = await reservePort();
      // eslint-disable-next-line no-await-in-loop -- keep each installed consumer alive only for its own readiness probe
      const opened = await runReadiness(
        process.execPath,
        [
          cli,
          "open",
          "--project-root",
          project,
          "--run",
          mismatchOutcome.runId,
          "--port",
          String(openPort),
          "--no-open",
        ],
        nestedCwd,
      );
      assert.equal(opened.readiness.kind, "framelia.open-ready");
      assert.equal(opened.readiness.command, "open");
      assert.equal(opened.readiness.selectedRun.runId, mismatchOutcome.runId);
      assert.equal(opened.stdout.trim().split("\n").length, 1);
      assert.match(opened.stderr, /Local:/);

      const gate = runOutcome(
        process.execPath,
        [
          cli,
          "done-gate",
          "--project-root",
          project,
          "--run",
          mismatchOutcome.runId,
          "--requirements",
          "missing-protected-requirements.json",
        ],
        nestedCwd,
        [2],
      );
      assert.equal(JSON.parse(gate.stdout).issues[0].code, "SIGNED_REQUIREMENTS_UNREADABLE");

      writeFileSync(
        path.join(project, "framelia.config.ts"),
        [
          'import { defineConfig } from "framelia";',
          'export default defineConfig({ playwright: { config: "playwright.check.config.ts", projects: ["", "named-visual"] }, contracts: ["contracts/check-*.json"] });',
          "",
        ].join("\n"),
      );
      rmSync(path.join(project, "check-lifecycle.log"), { force: true });
      rmSync(path.join(project, "check-executions.log"), { force: true });
      const namedCheck = runOutcome(
        process.execPath,
        [cli, "check", "--contract", "check.pass", "--project", "named-visual"],
        nestedCwd,
        [0],
      );
      const namedOutcome = JSON.parse(namedCheck.stdout);
      assert.equal(namedOutcome.executionState, "completed");
      assert.equal(namedOutcome.visualVerdict, "passed");
      assert.equal(namedOutcome.selection.selectedCount, 2);
      assert.deepEqual(namedOutcome.selection.selectedProjects, ["named-visual"]);
      assert.deepEqual(namedOutcome.diagnostics, []);
      assert.notEqual(namedOutcome.runId, passingOutcome.runId);
      assert.notEqual(namedOutcome.runId, mismatchOutcome.runId);
      assert.match(namedCheck.stderr, /consumer reporter noise/);
      assert.doesNotMatch(namedCheck.stdout, /consumer reporter noise/);
      assert.deepEqual(
        readFileSync(path.join(project, "check-executions.log"), "utf8").trim().split("\n"),
        ["named-visual:/pass", "named-visual:/pass"],
      );
      assert.deepEqual(
        readFileSync(path.join(project, "check-lifecycle.log"), "utf8").trim().split("\n"),
        ["setup", "setup", "cleanup", "cleanup"],
      );
      const namedPlansDirectory = path.join(project, namedOutcome.bundlePath, "plan", "case-plans");
      const namedPlans = readdirSync(namedPlansDirectory).map((fileName) =>
        JSON.parse(readFileSync(path.join(namedPlansDirectory, fileName), "utf8")),
      );
      assert.deepEqual(
        namedPlans.map(
          (plan) =>
            `[${plan.project.name}] › ${plan.registration.specFile} › ${plan.registration.titlePath.join(" › ")}`,
        ),
        [
          "[named-visual] › check.named.spec.mjs › [check.pass] Shared visual name",
          "[named-visual] › check.named.spec.mjs › [check.pass] Shared visual name",
        ],
      );
      assert.deepEqual(namedPlans.map((plan) => plan.repeatIndex).toSorted(), [0, 1]);
    }
    console.log(`[consumer smoke] PASS ${packageManager}/${mode}`);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
