import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
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
      run(process.execPath, [cli, "init", "--project-root", project], project);
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
    }
    console.log(`[consumer smoke] PASS ${packageManager}/${mode}`);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
