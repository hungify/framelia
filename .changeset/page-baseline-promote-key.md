---
"@framelia/contracts": minor
"@framelia/playwright": minor
"@framelia/dashboard-server": patch
---

Make the dashboard's `framelia baseline promote` command exact for page baselines.

- Playwright: `toMatchPageBaseline`'s score attachment records `baselineKey` when its baseline lives where `framelia baseline promote --key` writes it (not for a custom `baselineDir`), and the reporter projects it onto the dashboard result.
- Contracts: dashboard contract results gain an optional `baselineKey`; older runs without it still parse.
- Dashboard: the promote command uses `baselineKey` as `--key` and drops the "check the key" caveat when it is known; otherwise it falls back to the contract id with the caveat.
