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
| Playwright dependency | 1.64.1; product browser image not built yet |
| zod / Octicons | 4.6.7 / 19.42.0 |
| TypeScript / tsx | 5.9.3 / 4.20.6 |
| Actual inference provider / model | Direct Meta / muse-spark-1.3 |

**Chromium sandbox verdict:** no deployed product browser verdict. Browser UI verification of the dashboard does not prove runner isolation. No no-sandbox fallback is enabled.
