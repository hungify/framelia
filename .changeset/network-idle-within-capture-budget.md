---
"framelia": patch
"@framelia/contracts": patch
"@framelia/verify": patch
"@framelia/dashboard-server": patch
"@framelia/playwright": patch
---

Capture no longer lets the network-idle wait use up a short `timeout`: it waits at most half the capture budget (still capped at 5s), gives the rest to the font wait, and the warning names the wait that was actually used.
