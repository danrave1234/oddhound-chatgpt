# Connected local MVP

The local UI now performs the supported end-to-end flow: start a live owned demo, follow real Meta/browser actions, inspect candidates, approve an independent check, reproduce the violation, replay the unchanged assertion against the corrected demo and export the original evidence/recipe. These operations run through the actual web APIs and durable PostgreSQL admission state.

The live demo uses the existing development allocation, reserves up to $2 before execution, and enforces three interactive runs per UTC day and one global slot. The deterministic verification/retest make no model calls. A failed launch before any model turn/action releases its reservation and refunds its quota; its failed history remains visible. Unknown model usage stays held.

The explicit local profile accepts only Oddhound's owned internal HTTPS fixture. It never enables unverified customer targets or the public launch flag. A supervised host runner creates a fresh secret-free browser container for each run and confirms removal before finalizing/freeing capacity. The normal deployed browser candidate remains Fly. The Next.js web deployment target is Vercel, as clarified by Drave. GitHub OAuth configuration now produces the correct GitHub authorization URL/local callback; a full external sign-in session is not claimed from that redirect test.

## Actual UI execution

- Live exploration `a53f4907-b414-4bfc-bc8e-f33a06dfaf8f`: completed, 55 browser actions, 56 Direct Meta `muse-spark-1.3` turns, **$1.068351**, no pending/unknown usage. Signup, returning login, valid create/edit/cancel and invalid persisted values have independent owned-store observations. Five model candidates were saved.
- UI-approved assertion for `b1c4bba2-9023-47bb-a5ec-b38ba9b315a2` (“Create booking accepts -1 seats”): independent check `167c7249-c5d5-4e39-baec-0dca5148da50` failed as expected with its valid 3-seat control intact; the finding became verified/open.
- UI corrected-demo retest `3e11c8d1-d08e-4812-be92-8bec6de12b8b`: passed the **same** assertion hash with the control intact; the finding became verified/fixed. Verification and retest each used 15 browser actions and zero model calls/spend. All three browser containers were removed, and the API recorded actual host-confirmed cleanup.

Assertion: `ab42b4ea4f29e2befdc27c66c606a95165e0dc70e65f9226d6ac4fa279611ba8`. [Saved UI-flow evidence](evidence/interactive-mvp.json) contains the actual run/attempt/cleanup records. [The autonomous discovery record](evidence/meta-exploration-a53f4907-b414-4bfc-bc8e-f33a06dfaf8f.json) preserves the separate model evidence. The initial UI launcher failure `e4e4efbf-5af3-4fe9-81c6-9a803015f3e1` occurred on an unsupported Compose flag before inference. It cost $0, is retained as failed, and was corrected before the successful new run.

## Run the local UI

Start the regular app as documented in README.md. With Meta and the local development allocation configured in ignored `.env.local`, enable `ODDHOUND_ENABLE_PAID_LAB=1`, then run this supervised helper from the repository:

```powershell
pwsh -NoProfile -File apps/worker/owned-demo-host.ps1
```

Open `http://127.0.0.1:3000/`, choose **Try the demo target**, then **Start a live demo run**. This is real inference. The API refuses admission when the helper is offline, the slot is occupied, quota is spent, the kill switch is on, or the allocation cannot reserve the run. No key is returned to the browser. The helper/control endpoints are disabled for production and non-local identities. They do not replace the deployed public admission profile.

## Validation and limits

34 focused tests, seven real PostgreSQL integration tests, TypeScript, import policy and the production build pass. The new SQL test exercises live-helper admission, competing reservations, lost-claim cleanup, cancellation, refund and disabled production entry. Unit model replies remain synthetic; the UI exploration above is real inference. Actual Chromium 156.0.8078.4, Playwright 1.64.1, Node 26.12.1, non-root UID 1101 sandbox enabled.

This completes the supported local owned-demo interaction; it is not full project/release completion. Real verified-site hosting, private cloud artifact storage, complete deployed browser/egress/lifecycle and public tenant/budget gates, external-site coverage, hosted OAuth and submission remain required. Other model candidates remain unverified. Numeric create is the supported fixed-assertion template; broader oracle/recipe support remains incomplete.
