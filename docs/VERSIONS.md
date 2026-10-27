# Runtime and dependency versions

Verified local environment on October 27, 2026:

| Component | Version |
|---|---|
| Node | 26.12.1 in Docker; host unchanged |
| Node image | node:26-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe |
| PostgreSQL image | postgres:17-bookworm@sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27 |
| pnpm | 11.9.0 |
| Next / React / React DOM | 16.4.3 / 19.3.1 / 19.3.1 |
| Better Auth | 1.7.14 |
| Drizzle / pg | 0.45.2 / 8.23.1 |
| BullMQ | 6.4.2, PostgreSQL backend with explicit migrations |
| Playwright dependency | 1.64.1, matching the browser base image |
| zod / Octicons | 4.6.7 / 19.42.0 |
| TypeScript / tsx | 5.9.3 / 4.20.6 |
| Actual inference provider / model | Direct Meta / muse-spark-1.3 |

**Local Chromium sandbox verdict:** enabled in the owned browser lab, UID 1101, Chromium 156.0.8078.4. Namespace, PID/network namespaces and Seccomp-BPF report Yes. This is an actual product-runner launch, not a dashboard browser check. No Fly/deployed verdict exists and no no-sandbox fallback is enabled.

Browser helpers: mitmproxy 12.3.1; smokescreen commit 68e7b8218e226bc47d09ce705fdb8fed82145ceb built with Go 1.26.10. Browser base: mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea. Exact local image fingerprints and per-run sandbox evidence accompany the browser records.

The browser CI startup correction changes no dependency version or sandbox setting. Local verification after the correction: 14 real scripted browser checks, three PostgreSQL integration tests, TypeScript and import policy checks passed. The initial remote failure remains linked from BROWSER_RUNTIME.md.

The subsequent autonomy slice uses the same provider/model and runtime versions. It passes 20 focused tests with synthetic model replies, four real PostgreSQL integration tests and 15 actual scripted browser checks. Two real Meta-driven workflows complete against the vulnerable and corrected owned fixture; a stopped attempt remains recorded. The recorded development cost is $2.216998, all usage settled. The model received no screenshots; Fly sandbox/lifecycle proof and backup providers remain untested. Full evidence and the new local image digest are in AUTONOMOUS_EXPLORATION.md and docs/evidence/browser-image.json.

Owner-contract slice (same runtime/dependency versions): 27 focused tests, five PostgreSQL integration tests, four Python request checks, 15 real browser workflow checks and 11 mapped-policy checks passed locally. The sandbox remains enabled under UID 1101, Chromium 156.0.8078.4. The tested local image is recorded separately in docs/evidence/owner-grants-image.json. No new provider smoke or Fly verdict is claimed.

Numeric-assertion slice (same versions): Node 26.12.1, pnpm 11.9.0, Next 16.4.3, React 19.3.1, Playwright 1.64.1 and actual Chromium 156.0.8078.4. Thirty-four focused tests and six PostgreSQL integration tests pass. One real Meta candidate was independently reproduced and its exact assertion passed after the target correction. Verification/retest are scripted deterministic checks with no new inference, not another autonomous discovery claim. The existing 15 workflow and 11 mapped-policy canaries pass on the assertion-capable browser image. ASSERTION_RETESTS.md and its per-run records own the local image fingerprints and limits. No dependency version, Fly verdict or public-launch gate changed.
