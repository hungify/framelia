---
"framelia": patch
"@framelia/contracts": patch
"@framelia/verify": patch
"@framelia/dashboard-server": patch
"@framelia/playwright": patch
---

`framelia completion install` and `framelia completion uninstall` never load the project's `.env`, so no project setting can steer which shell profile they edit.
