---
paths:
  - ".changeset/**"
  - "packages/*/src/**"
  - "packages/*/package.json"
---

# Changesets and releases

The five published packages (`framelia`, `@framelia/contracts`, `@framelia/verify`, `@framelia/dashboard-server`, `@framelia/playwright`) are one **fixed** group in `.changeset/config.json`: they always release at the same version, and CI's `publish` job refuses mismatched versions. `@framelia/dashboard` is private and ships inside `@framelia/dashboard-server`'s `dist/dashboard`.

- Any change a consumer can observe in a published package (API, CLI flags or output, contract schema, run-bundle format, dashboard UI) gets a changeset in the same commit: `pnpm changeset`, or a hand-written `.changeset/<kebab-topic>.md`.
- List every package of the fixed group in the frontmatter with the same bump, as the existing changesets do, and write the body for consumers: what they can now do or must change, not how it was implemented.
- Pure refactors, tests, docs and repo tooling need no changeset.
- Never run `pnpm version-packages` or edit package versions by hand on a feature branch; releasing is a separate `chore: version packages` commit.
- A breaking change also gets `!` in the Conventional Commit header (`feat(contracts)!: …`). Changing an authored contract schema in a way existing contract files no longer parse means bumping `SCHEMA_VERSION` in `packages/contracts/src/constants.ts`; workflow records carry their own `formatVersion` constants.
