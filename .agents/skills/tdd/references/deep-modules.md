# Test the surface, not the internals

Read by the RED phase, with [tests.md](tests.md).

## The idea

A deep module hides complex internals behind a simple interface. Test that interface, not the complexity underneath. Tests that break every time the internals move make refactoring frightening instead of routine.

Every module has two parts:

1. **Surface**: what callers depend on. Here: a package's subpath exports (`@framelia/verify`, `@framelia/verify/run-bundle`, `@framelia/contracts/workflow`), the CLI's flags, output and exit codes, the matchers and Reporter as Playwright sees them, the files a run bundle publishes, a dashboard `lib/` export or composable.
2. **Internals**: everything that can change freely. Here: `internal` modules, private helpers, the order of steps inside a capture, component structure.

Tests exercise (1) and ignore (2).

```ts
// GOOD: what the schema promises
expect(verificationContractSchema.safeParse({ ...contract, id: "Checkout Page" }).success).toBe(
  false,
);

// BAD: how it works inside (the regex the schema happens to use today)
expect(CONTRACT_ID_PATTERN.test("Checkout Page")).toBe(false);
```

## The swap test

Could you rewrite the internals completely and have the test still pass? Yes: the test is at the right level. No: it is coupled to the code.

## When the surface grows

A module whose interface keeps growing (more params, more exports) probably wants splitting. Each new module then gets its own surface tests. The `codebase-design` skill has the vocabulary for that conversation.

## Private functions

Private functions exist to serve the public interface; test them through it. One complex enough to seem to need its own tests deserves to become its own module with an export and its own tests.

---

Adapted from [spences10/claude-code-toolkit](https://github.com/spences10/claude-code-toolkit/tree/main/plugins/dev-practices/skills/tdd) (`references/deep-modules.md`).
