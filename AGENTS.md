# AGENTS.md

Framelia: Playwright matchers (`toMatchFigma`, `toMatchPage`, `toMatchUrl`) plus a CLI and Vue dashboard for Figma-to-web and web-to-web visual verification. pnpm monorepo, TypeScript, Node 22.13+ (`.tool-versions`). Architecture and package graph: `README.md`.

- `packages/contracts`, `verify`, `dashboard-server`, `playwright`, `cli` (published as `framelia`), and `apps/dashboard` (private, bundled into `dashboard-server`). Packages are deep modules: read [packages/README.md](./packages/README.md) before adding a package or importing across packages (`pnpm lint:boundaries` enforces it). The dependency direction is in `.agents/rules/package-boundaries.md`.

## Commands

- `pnpm install` (also installs git hooks and runs `pnpm agents:link`), then `pnpm exec playwright install chromium` once.
- `pnpm --filter <pkg> test [tests/<file>.test.ts] [-t '<name>']`: one package, file or test. No `--` before the file: it makes Vitest run everything.
- `pnpm validate`: zero-deps check, typecheck, `lint:boundaries` (dependency-cruiser), all tests, lint (Oxlint + ESLint), format check, Knip. Run before finishing.
- `pnpm lint:fix`, `pnpm fmt`: Oxlint + ESLint fixes, Oxfmt. `pnpm knip`: unused files, dependencies and exports (`knip.config.ts`).
- `pnpm size`: build the dashboard and check its bundle budgets (`.size-limit.json`). Raise a budget only with a reason in the commit message.
- `pnpm build`, `pnpm dev:dashboard` (mock data), `pnpm framelia <args>` (CLI from source).
- `pnpm test:consumer`, `pnpm --filter @framelia/playwright test:smoke*`: packed-consumer and Playwright end-to-end smoke.
- `pnpm --filter <pkg> test:mutation --mutate <files>`, `pnpm test:mutation:smoke`: Stryker; use the `mutation-testing` skill.
- `pnpm changeset`: record a consumer-visible change (`.agents/rules/changesets.md`).

## Where to run

- Start Claude Code from the repo root. `.claude/settings.json` (`.env` guard hook, deny rules, plugins, MCP servers) is not inherited from parent directories, so a session started inside a package would skip it.

## Code search (fff)

- `.mcp.json` registers the [fff](https://github.com/dmtrKovalenko/fff) MCP server (`fff-mcp` must be on `PATH`; install it yourself, see the fff repo).
- For any file search or grep in this repo, use the fff tools (`mcp__fff__find_files`, `mcp__fff__grep`, `mcp__fff__multi_grep`) instead of the default Glob/Grep.

## Code graph (codebase-memory-mcp)

- `.mcp.json` also registers [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), a local code knowledge graph (functions, call edges across packages). Install the binary yourself (`--skip-config` avoids touching agent configs). Indexes live in `~/.cache/codebase-memory-mcp/`, not in the repo.
- First use in a session: if the graph looks empty or stale, run `index_repository` on the repo root.
- Use it for structural questions (who calls X, impact of changing an export across packages, architecture overview). Use fff for plain text/file search.

## Rules and skills

- Rules, skills and subagents are authored in `.agents/{rules,skills,agents}/` (tracked). `pnpm agents:link` (part of `pnpm install`) symlinks them into the git-ignored `.claude/`, so edit `.agents/`, never the links. Rerun it after adding or removing one. A package can carry its own `packages/<name>/.agents/`; the script links those too.
- Rules (path-scoped, read the matching one before changing code): `package-boundaries.md`, `code-style.md`, `comments.md`, `testing.md`, `changesets.md`, `dashboard.md`.
- Behaviour changes (features, CLI flags, schema fields, bug fixes) go test-first with the `tdd` skill: red, green, refactor, one subagent per phase (`.agents/agents/tdd-*.md`, guarded by `.claude/hooks/tdd-guard.mjs`). When another skill or plan says to use test-driven development, use `tdd`. At the end of a branch, `mutation-testing` checks that the tests catch bugs.
- The other skills come from `mattpocock/skills` via `skills-lock.json` (`npx skills`); `tdd` and `mutation-testing` are this repo's own and are not in the lock file.

## Rules

- Never read, edit or commit `.env*` files (only `.env.example` is tracked); the Figma token lives there. No secrets in commits.
- Conventional Commits, enforced by commitlint on `commit-msg` (`commitlint.config.mjs`): `type(scope): subject`, scope = package or area (`cli`, `verify`, `dashboard`, `repo`), header max 100 chars, `!` for breaking changes. Hooks also run lint-staged on `pre-commit` and `pnpm typecheck` on `pre-push`; fix the cause instead of `--no-verify`.
- Dependencies: `pnpm-workspace.yaml` sets `minimumReleaseAge` (versions younger than 1 day are not resolved) and `blockExoticSubdeps`. CI's `audit` job runs `pnpm audit --audit-level high` (only high and critical advisories are fixed; triaged ones are listed under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`) and Gitleaks over the git history (allowlist in `.gitleaks.toml`). Refresh the lockfile with `pnpm update --no-save`: plain `pnpm update` rewrites the ranges consumers see.
- CI is GitHub Actions (`.github/workflows/ci.yml`); publishing to npm happens there from `main`. Leave package versions and `pnpm version-packages` to release commits.

## Agent skills

### Issue tracker

Issues live as GitHub Issues on `hungify/framelia`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Standard five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) — label strings match role names exactly. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
