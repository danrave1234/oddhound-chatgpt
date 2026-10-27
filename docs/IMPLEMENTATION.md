# Implementation

All product source, tests and implementation notes live in this directory. The parent AGENTS.md and its owning specifications supply the product requirements.

The product uses Next.js/React, PostgreSQL with Drizzle and the BullMQ PostgreSQL backend, a Direct Meta adapter, and a separate secret-free browser runtime. There is no Redis and no alternative agent framework. Public target execution stays disabled until its required deployed gates pass. Local development binds the dashboard to loopback and identifies its explicitly enabled local workspace.

## Current implementation

The workspace saves sites through Drizzle/PostgreSQL and presents all three ownership methods. Verification helpers pin public DNS results at the TLS dial and reject redirects. GitHub/Better Auth schema migrations run; actual OAuth is not configured. Target credential references use authenticated encryption. Runs have persisted events, candidate findings, workflow history, report exports, cancellation and reserved spend. The PostgreSQL BullMQ worker/outbox and independent reaper run locally. Fly controller code exists; the browser image/control service is the next implementation slice.

The active tool loop validates Meta replies, commits intent before browser actions, checks generation/expiry/kill fences and accounts for ambiguous usage conservatively. It has not yet exercised an autonomous browser. The admission gate remains closed. Runtime configuration is never treated as a passing integration test.

## Actual verification

- TypeScript passed and the production build completed. The dependency audit found an affected Drizzle 0.45.0 release; it was upgraded to patched 0.45.2 before publication.
- Twelve focused tests passed with explicitly synthetic model transport/browser observations.
- Two tests against a dedicated PostgreSQL test database passed: competing spend reservations/cancellation/unknown usage and actual BullMQ delivery/outbox deduplication. No Redis.
- The owned Fieldwork fixture passed scripted HTTP registration/login/create/edit/cancel checks in both modes. Independent SQL confirmed the vulnerable negative-seat write and its rejection by the corrected mode, while the valid control remained functional.
- Direct Meta authentication and a real two-call tool protocol smoke passed. Model: muse-spark-1.3; accounted cost $0.004119. Its tool observation was synthetic and no website was scanned. See PROVIDER_SMOKE_TESTS.md.
- The dashboard rendered successfully. Saved-site persistence and ownership-method switching were checked in the browser. After a Docker restart, stale development chunks prevented hydration. Rebuilding the generated development cache restored interaction; the site dialog opens and focuses its name field. The screenshot is presentation evidence, not a full autonomous scan.

For reproducible SQL tests, create `oddhound_test` in the local PostgreSQL service, then run migrations and `pnpm test:integration` with DATABASE_URL pointing to that database. Tests refuse a database name without `_test`.

## Remaining implementation

The next slice is the disposable browser image and working trusted control/tool path, with captured artifacts. Then complete explicit account/fixture/API grants, autonomous signup/login and unexpected writes, independent assertions and unchanged retests, live demo admission/fixture isolation, all tenant/evidence/public-budget gates and deployment. Full atomic compute accounting and release attestations also remain unfinished; existing configuration checks are not proof of a funded containment profile.

Known planning risks still applicable include B01/B02 (image/provider profiles), B03/B04/B09/B18/B22/B23 (deployed browser isolation and policy), B06/B19 (autonomous rule/account/fixture behavior), B07/B21/B24/B26 (hosted recovery/accounting/limits), B08 (complete artifact/tenant protections), B20 (anonymous demo funding/isolation) and B27 (deployed access). The earlier audit's remaining closure gates are not waived. This is product implementation, not a new standalone blocker audit.

## Access and assumptions

Meta is configured locally and verified. GitHub repository access is available; product GitHub OAuth and Fly access are not configured. The vault key is local and ignored. No target credential was sent to Meta. No public site scan, Fly deployment or product Chromium sandbox verdict occurred. The engineering replay and fixture checks are scripted and clearly labelled. Local database passwords are disposable development values, not production credentials.

Exact runtime/dependency versions are in VERSIONS.md. All changes, notes and evidence for this implementation stay in this repository.
