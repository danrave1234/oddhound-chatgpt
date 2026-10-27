# Hosted execution and shared evidence

The [hosted preview](https://oddhound-chatgpt-preview.vercel.app) runs in `danrave1234s-projects/oddhound-chatgpt` on the existing **Vercel Hobby** workspace. No paid Vercel upgrade was selected. The CLI is already authorized; the connector's additional workspace grant is unnecessary for this setup. `oddhound-chatgpt-db` was provisioned on Neon's explicitly selected **free_v3 / Free** plan in Singapore. The worker and disposable browsers use separate Fly apps, billed separately from Meta credit.

Vercel's native Node version selector currently offers 24 and 22. `Dockerfile.vercel` instead builds and runs the same Next.js application with pinned Node 26.12.1 using Vercel's [Container runtime](https://vercel.com/docs/functions/runtimes/container), available on all plans. The project selects the Container preset. The local production image builds successfully, serves all three landing actions, and returns 401 for signed-out private runs and the development runner. It runs as UID 1000. The hosted deployment independently reports Node v26.12.1, database connected and worker online.

The first frontend deployment [failed before Docker startup](evidence/vercel-native-engine-failure.json): Vercel's harness applied its native Node selector to the root package. Source/runtime floors were retained. `scripts/prepare-vercel.ps1` now inventories tracked files and runs the Node 26 packaging helper to place application source under `source/` beside the same Docker recipe. There is no root Node package for the platform harness to select. The staged context passes a real Docker production build; deployment source inspection confirms Container, no root package and no private/env/data paths. The helper saves source hashes and whether local changes were present. Use a clean committed tree for the final preview.

```powershell
pwsh -NoProfile -File scripts/prepare-vercel.ps1
# Use the directory printed by the helper.
vercel deploy --cwd data/vercel-source-<commit-prefix> --project oddhound-chatgpt --scope danrave1234s-projects --yes
```

The [hosted HTTP proof](evidence/vercel-preview.json) records READY deployment `dpl_CsXwJFLiC31h1GfnmpzsZVdUyRza`, source commit `48c3656e9aacb771a69517af4def675b10da2a1e`, signed-out private-run refusal (401), the recorded replay (200), and the actual GitHub authorization redirect with the hosted callback. The owner completed the callback update/sign-in; the actual hosted GitHub account and unexpired session are recorded in [session evidence](evidence/hosted-github-session.json). Vercel Authentication protection remains enabled. The proof uses the documented short-lived same-project OIDC header. A persistent automation bypass created by an earlier CLI diagnostic was revoked; it is not needed to use the preview. No browser job or inference is claimed by this HTTP check.

## Actual Fly result

[Probe 6173dbf3](evidence/fly-startup-6173dbf3-5b57-4b5b-a237-db0d9fd020b1.json) passed on a fresh browser Machine in `sin`:

- Actual Chromium 156.0.8078.4, Playwright 1.64.1, non-root UID 1101, namespace/PID/network namespaces and Seccomp-BPF enabled.
- The exact trusted controller reached private readiness. A separate untrusted Machine could not open the control port; the allowed controller still worked afterward.
- Browser UID 1101 reached its loopback gateway proxy. Connections to other loopback, metadata, private IPv4, direct public TCP, browser control and controller 6PN were denied.
- The checked browser runtime environment had no forbidden platform credential names. Its Machine had no public services or persistent mounts. Separate app queries returned no allocated public IPs and no app secrets.
- All three probe Machines were destroyed, and the provider listing confirmed removal.

Pinned browser index: `registry.fly.io/oddhound-chatgpt-browser@sha256:9b3cd6594a805543937fa461eae397e60a25441f68607ad18b16f7f8de3fb4fd`. The older `ff2d1972...` image and failed records remain historical evidence.

The deployment initially timed out because the firewall blocked kernel IPv6 neighbor discovery to Fly's gateway (`fe80::1 dev eth0` was FAILED). The fix validates that exact default route and allows only gateway neighbor-solicitation/advertisement traffic with hop limit 255. Browser/gateway/smokescreen UID drops precede the output exception. No browser private-address permission, TLS bypass or no-sandbox flag was added. A second early false failure counted a missing services array as one service; the corrected check and subsequent complete passing run are retained separately.

This is startup, native-egress and control evidence. The probe never initialized a target, supplied target credentials, navigated a website or called Meta. It does **not** clear the full redirected/worker/resource policy matrix, resource exhaustion, complete lifecycle fault matrix, atomic compute accounting, two real-site runs or public release. No additional Plan Audit ID is declared fully closed.

## Deployed worker and independent crash recovery

The production queue worker (`2862752f6e1058`) and independent reaper (`683732ef554118`) run in the trusted worker app with Node v26.12.1. The initial image was `sha256:41bca20cfd26959079e8d4aa97ba6a6c3db2011401eb400899d9712b96b75f9e`; both now use the [verified compute-ledger deployment](evidence/fly-compute-services.json), index `sha256:b444888a47e07856bc5f8c559a173b0706427b7d92f3d6e6a72bac5dcca83053`, resolved amd64 manifest `sha256:f31b6177435f59fdd5fe33867a8f7561f82209eedc750e7ca83fce76612acfbe`. The PostgreSQL worker reports ready; the hosted web status sees its heartbeat. The separate browser app still has no platform secrets, public services/IPs or persistent volume. Public execution remains disabled and no admission attestation has been fabricated.

The [actual controller-exit proof](evidence/fly-lifecycle-c469f007-2dd4-490f-9a7f-ace118ba3e2b.json) deliberately omitted the `browser_machines` row after creating a fresh sandboxed browser. Fly logs confirm the controller exited with code 42. The independent production reaper discovered and removed the browser before guest expiry. The run remained active/finalizing until the allocation deadline plus the 60-second unknown-create window: required hold through `11:22:46.947Z`, finalized `11:22:50.683Z`. There were zero actions, turns or model calls, and no remaining canary Machines. This proves one deployed orphan recovery/capacity case, not every lifecycle fault. The [earlier late-observer attempt](evidence/fly-lifecycle-337f0429-9ad7-4a23-8058-272a3d82c0c2.json) remains `passed: false`; its cleanup succeeded but the observer missed the timing window. Start the observer before launching the manual canary. `apps/worker/lifecycle-probe.ts` is a targetless, explicitly flagged manual executable, never part of normal admission or CI.

The [deployed Meta access check](evidence/meta-access-fly.json) returned HTTP 200 and listed `muse-spark-1.3` from the actual trusted Fly worker. This was `GET /v1/models`, with **no inference**. A hosted browser/model product run remains unverified. Before any cloud inference, reconcile the existing local development/public usage into the canonical hosted ledger; a second empty database must not reset the credit allowance.

## Actual hosted PostgreSQL result

[Hosted database evidence](evidence/hosted-postgres.json) records PostgreSQL **18.6 (fd34222)**, client **TLS 1.3**, encrypted/authorized socket and `sslmode=verify-full`. The backend's `pg_stat_ssl` observation is saved separately from the actual client socket verdict. No certificate verification was disabled.

Application, Better Auth and explicit BullMQ PostgreSQL migrations ran. Ten integration tests passed against a dedicated hosted `_test` database, including actual BullMQ delivery/outbox deduplication, competing reservations, unknown usage, fixed assertions, queue kill/refund/claim behavior and private image persistence. The queue uses the direct/unpooled session connection, as required for [LISTEN/NOTIFY](https://neon.com/docs/connect/connection-pooling). No Redis is used. These tests do not claim an actual hosted Meta/browser job or completed OAuth sign-in.

## Private screenshots and bounded responses

Production screenshots now use PostgreSQL binary storage alongside their metadata, so Fly and Vercel share the same private evidence without another storage subscription. Local historical files continue to work. Filesystem writes are refused in production.

Images retain tenant checks, PNG/dimension/size validation, SHA-256 verification and the serialized 100 MiB per-run artifact limit. Image bytes and ready metadata commit atomically; deleting their metadata cascades to the stored content. Actual SQL tests prove cross-owner refusal, tamper refusal and competing writes at the byte ceiling. The fixture PNG in these tests is synthetic, not browser-run evidence. Global retention/storage headroom and the rest of the evidence release gates remain unfinished.

Observation metadata is capped at 64 KiB even without a screenshot. Polling/SSE return compact browser timeline/frame fields; the original observations remain saved and are available through the owner-bound `/api/runs/:runId/events/:eventId` endpoint, bounded at 128 KiB. A 250-observation SQL test proves compact transfer without changing the originals. The actual 55-action run's UI API response is 55,871 bytes and its original observation detail returns successfully.

## Validation and access

The compute-ledger follow-up raises local and hosted SQL coverage to 12 passing tests, with 39 focused tests and unchanged browser regressions. Its price/provider/time fixtures are synthetic; no production compute funding was enabled. [COMPUTE_ACCOUNTING.md](COMPUTE_ACCOUNTING.md) owns the new reservation and overdue-cleanup behavior. Full public execution remains disabled.

This slice passes 39 focused tests (synthetic model transports), 10 local PostgreSQL integration tests, 10 hosted PostgreSQL integration tests, TypeScript, 15 real browser workflow checks, 11 mapped-policy canaries and four Python policy tests. Dependency audit reports no known vulnerabilities; import policy passes for 89 source files including the manual lifecycle probe. Actual deployed worker/reaper Node versions, hosted HTTP checks, sandbox/private control/native egress and the controller-exit case are recorded separately above. No additional Meta inference occurred; the last actual product model remains Direct Meta `muse-spark-1.3`. Development model spend remains $3.285349 of $5, with no held/unknown usage. The $15 judging reserve remains unused. Full public admission stays disabled.

Production and Neon database connections now force `sslmode=verify-full`, including when the provisioned URL requests weaker verification. Idle pool errors are handled without logging credentials. `/api/status` reports the actual web Node runtime for deployment verification.

GitHub Actions passed for [hosted storage and Fly startup commit cc2c54f](https://github.com/danrave1234/oddhound-chatgpt/actions/runs/40488651847) and [Node 26 frontend packaging commit 48c3656](https://github.com/danrave1234/oddhound-chatgpt/actions/runs/40489829122). These are exact committed results, not a claim about an unpushed successor.

The first HTTP-client diagnostic exposed a temporary app-scoped Fly startup token in tool output. Its revocation was confirmed; the worker startup token and all later startup test tokens were also revoked, and the private cache was removed. Token values and private control capabilities are absent from these records and source. Provisioning errors now emit only bounded status codes/types. TLS verification remains enabled.

Remaining work includes the complete Fly runtime/reaper/resource and compute gates (B03/B04/B09/B18/B22/B23/B24), hosted orchestration/recovery/budgets (B07/B21/B26), complete tenant/evidence/fixture semantics (B06/B08/B19/B20), external verified sites (B15), and hosted access/submission (B27). Configuration and these passing component tests do not certify the complete system.
