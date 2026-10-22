// For the repo root and each workspace package that has one, symlinks everything under
// `.agents/<dir>/<entry>` into `.claude/<dir>/<entry>`, so `.agents/` is the single source of truth
// (tracked) and Claude Code still finds it. The links are git-ignored and removed when the source is
// gone. If the OS refuses symlinks (Windows without Developer Mode), it copies instead; rerun after
// editing.
// Usage: pnpm agents:link (also runs on `pnpm install` via `prepare`)
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const log = (message) => process.stdout.write(`${message}\n`);

const repo = fileURLToPath(new URL("..", import.meta.url));
const workspaceAreas = ["packages", "apps"].flatMap((group) =>
  existsSync(join(repo, group))
    ? readdirSync(join(repo, group), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${group}/${entry.name}`)
    : [],
);
const areas = [".", ...workspaceAreas];

let changes = 0;

for (const area of areas) {
  const root = join(repo, area);
  const source = join(root, ".agents");
  const target = join(root, ".claude");
  if (!existsSync(source)) continue;

  for (const dir of readdirSync(source, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const targetDir = join(target, dir.name);
    mkdirSync(targetDir, { recursive: true });

    // Dotfiles stay local: tools such as pnpm write their own `.claude/skills/.gitignore`.
    const entries = readdirSync(join(source, dir.name)).filter((entry) => !entry.startsWith("."));

    for (const entry of entries) {
      const from = join(source, dir.name, entry);
      const to = join(targetDir, entry);
      const link = relative(targetDir, from).split(sep).join("/");

      const stat = lstatSync(to, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink() && readlinkSync(to).split(sep).join("/") === link) continue;
      if (stat) rmSync(to, { recursive: true, force: true });

      try {
        symlinkSync(link, to);
        log(`${join(area, ".claude", dir.name, entry)} -> ${link}`);
      } catch (error) {
        if (error.code !== "EPERM") throw error;
        cpSync(from, to, { recursive: true });
        log(`${join(area, ".claude", dir.name, entry)} copied (symlinks not permitted)`);
      }
      changes++;
    }

    for (const entry of readdirSync(targetDir)) {
      const to = join(targetDir, entry);
      if (entries.includes(entry) || !lstatSync(to).isSymbolicLink()) continue;
      if (!readlinkSync(to).split(sep).join("/").includes(".agents/")) continue;
      rmSync(to);
      changes++;
      log(`${join(area, ".claude", dir.name, entry)} removed (source is gone)`);
    }
  }
}

log(changes === 0 ? "Already up to date." : `Updated ${changes} link${changes === 1 ? "" : "s"}.`);
