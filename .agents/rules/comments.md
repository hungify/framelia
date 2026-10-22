---
paths:
  - "packages/**/*.ts"
  - "apps/dashboard/**/*.ts"
  - "apps/dashboard/**/*.vue"
  - "scripts/**/*.{ts,mjs}"
---

# Code comments

A comment records what the code cannot: **why** it is this way, or the **invariant** it protects. Names and types carry the _what_.

## Write one for

- An invariant or guarantee a reader could break without noticing: "every started run terminalizes exactly once", "digests are computed over canonical JSON with sorted keys".
- A deliberate surprise: ordering dependencies, `await` in a loop, a permissive (`.loose()`, `.catch()`) schema, an `import()` kept lazy for startup weight.
- A constraint the type cannot carry: unit, format, coordinate space ("crop-relative, not viewport").
- A rejected alternative that looks obvious but fails.
- A JSDoc block on exported API whose name and types do not show usage, side effects or failure mode. Boundary tests and guard scripts open with a block saying which invariant they enforce and why it matters; follow that pattern for new ones.

## Keep them true

- Describe the code as it is now. History ("previously", "fixed", "added for") belongs in the commit message and changeset.
- Update or delete a comment when the code under it changes; delete commented-out code.
- A comment that excuses a name or a tangled condition is a rename or an extracted, named `const` instead.
