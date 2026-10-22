---
"framelia": minor
---

Add bash completion for the `framelia` CLI through `@stricli/auto-complete`.

- `framelia completion install` / `framelia completion uninstall` add or remove a marked completion block in `~/.bashrc` and print one `framelia.completion-outcome` JSON object; a non-bash `$SHELL` or a missing `~/.bashrc` is a structured exit-`2` failure. Neither reads the project's `.env`.
- The package ships a second executable, `__framelia_bash_complete`, which proposes routes, flags and enum values from the route tree alone: it never loads `.env`, runs a command, or loads a heavy adapter.
