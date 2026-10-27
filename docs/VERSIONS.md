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
