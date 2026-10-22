---
"framelia": patch
"@framelia/contracts": patch
"@framelia/playwright": patch
---

Report operational failures as exit `2` and share CLI binding, pinning and transport rules.

- `framelia capture`, `contract suggest-masks` and `baseline promote` now exit `2` when the Figma fetch, navigation or capture fails, instead of the visual-mismatch exit `1`.
- `contract create` no longer runs the whole `contract list` command to decide `runnable`; it classifies bindings with the same rule as `check` and `contract list`. A binding-inspection failure after authoring is reported as a diagnostic instead of being dropped.
- `contract create` and `contract refresh-baseline` both report the first invalid contract's code when discovery must be repaired.
- `@framelia/contracts/workflow` exports `RUN_CONTEXT_ENV`, the variable the CLI and the Reporter share.
