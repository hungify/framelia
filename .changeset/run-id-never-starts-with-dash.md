---
"framelia": patch
"@framelia/contracts": patch
"@framelia/verify": patch
"@framelia/dashboard-server": patch
"@framelia/playwright": patch
---

Run ids are now alphanumeric, so `framelia report|open|dashboard --run <id>` no longer fails for the roughly 1-in-64 run whose id began with `-` and was parsed as a flag.
