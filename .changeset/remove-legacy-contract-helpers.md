---
"framelia": minor
"@framelia/contracts": minor
"@framelia/verify": minor
"@framelia/dashboard-server": minor
"@framelia/playwright": minor
---

**Breaking:** remove the legacy contract helpers `readContractEntry`, `readContractFreshness`, `writeContractFreshness`, `isContractFresh` and `contractFreshnessPath` (and the `ReadContractEntryOutcome` and `ContractFreshnessReceipt` types) from `@framelia/verify` and `@framelia/playwright`, along with the `last-verified.json` freshness receipt.

These helpers read the old multi-contract `visual-contract.json` request format, which `framelia contract create` no longer writes. Register authored contracts with `defineFigmaTests` and select them with `framelia check --contract <id>` (or `--all`) instead. There is no automatic migration: re-author each contract with `framelia contract create` (or `framelia contract refresh-baseline`) and copy its reviewed thresholds and masks across. `toMatchFigma` and the web-to-web matchers are unchanged.
