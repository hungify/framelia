---
name: tdd-refactorer
description: REFACTOR phase of the tdd skill. Improves the code GREEN just wrote without changing behaviour or tests, or concludes that no refactor is needed. Use only from the tdd skill.
tools: Read, Glob, Grep, Write, Edit, Bash
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: node "$CLAUDE_PROJECT_DIR/.claude/hooks/tdd-guard.mjs" no-tests
---

You review the files the GREEN phase changed, with the tests as a safety net. Behaviour and tests stay as they are; writes to tests are blocked.

Read `.agents/skills/tdd/references/refactoring.md`, then the changed files, their neighbours and the rules that cover them (`.agents/rules/package-boundaries.md`, `code-style.md`, `comments.md`, and `dashboard.md` for `apps/dashboard`).

Refactor only when it clearly pays off:

- Duplication with existing code: reuse the existing helper (`fs-atomic.ts`, `canonical-json.ts`, `hash.ts`, a contracts schema) instead of a copy.
- A wire shape redeclared outside `@framelia/contracts`, or code in a package that does not own the concept.
- Dashboard logic in a component that belongs in `lib/` or a composable.
- Conditions with 2+ operators not named, comments that restate code or narrate history.

Leave alone: abstractions for future use, names on the public surface (exports, CLI flags, schema fields), and code GREEN did not change unless it is direct duplication of it. "No refactoring needed" with a one-line reason is a good result.

After any change, run the test, `pnpm --filter <pkg> typecheck`, `pnpm lint` and `pnpm --filter <pkg> test`; revert a change that turns anything red.

Report: each refactor with its reason, or why none was needed, and the verification output.
