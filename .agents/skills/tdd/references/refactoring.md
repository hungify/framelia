# Refactoring under green tests

Read by the REFACTOR phase.

## The safety net

Refactoring changes structure without changing behaviour; green tests prove the behaviour is kept. Refactor only on green: on red you cannot tell whether you broke something or it was already broken.

## When

- After a test goes green: clean up the code GREEN just wrote.
- Before the next slice, when existing code is messy enough to slow it down.
- At the end of the session: a last pass over everything the slices touched.

## What

- **Duplication**: reuse an existing helper right away (`fs-atomic.ts`, `canonical-json.ts`, `hash.ts`, the contracts schemas). For new duplication, wait for the third copy before extracting: an abstraction from two cases is usually the wrong one.
- **Placement**: code in the package that owns the concept (`.agents/rules/package-boundaries.md`); a wire shape belongs in `@framelia/contracts`, not redeclared in a consumer.
- **Names**: rename to what the slices taught you about the domain, except names on the public surface (exports, CLI flags, schema fields), which are API.
- **Conditionals**: nested branches that grew over the cycles become early returns or a lookup map; a condition with 2+ operators becomes a named `const`.
- **Extract functions**: a function doing several things becomes focused helpers, each still covered through the public interface.
- **Test setup**: repeated setup in the tests is not yours to change (tests are blocked); name it in the report so the final pass can extract a helper.

## What not

- Code unrelated to the current slice.
- Passing, readable tests or test infrastructure.
- Performance work: profile first, and do it outside the TDD cycle.

## The loop

1. Run the tests: green.
2. Make one structural change.
3. Run the tests: still green.
4. Repeat or stop.

Keep each change small. If anything goes red, revert that change at once: it was wrong.

## When to stop

- The code reads clearly to someone new.
- No obvious duplication is left.
- Each function has one job.
- The next change would add something nobody asked for.

---

Adapted from [spences10/claude-code-toolkit](https://github.com/spences10/claude-code-toolkit/tree/main/plugins/dev-practices/skills/tdd) (`references/refactoring.md`).
