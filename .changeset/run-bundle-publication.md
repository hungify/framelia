---
"@framelia/contracts": minor
"@framelia/verify": minor
"@framelia/playwright": minor
"@framelia/dashboard-server": minor
"framelia": minor
---

Make one immutable selected run the durable source of truth for reporting and authoritative gating.

- Publish and structurally validate versioned run plans, full case plans, attempts, selected-attempt reconciliation, and portable evidence paths. Remove the legacy `VerificationArtifact` authority path.
- Freeze authored contracts, exact project/repeat membership, baseline bytes, policy and registration identities, retry acceptance, and the policy-selected 2–5 screenshot stability count. Capture samples back-to-back without reload, retain every hash, and remove private sample images.
- Project the exact selected run into live, archived, and static dashboards, including retry history, per-attempt evidence and diagnostics, and source/policy/binding/spec provenance.
- Require `done-gate` to load the selected run itself and verify a protected Ed25519-signed CI/deployment requirements envelope against a public key pinned outside the checkout.
- Export relocatable selected-run reports without writer-machine paths and return structured incomplete verdicts for missing, malformed, or tampered authority inputs.
