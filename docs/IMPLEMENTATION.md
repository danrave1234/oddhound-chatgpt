# Implementation

All product source, tests and implementation notes live in this directory. The parent AGENTS.md and its owning specifications supply the product requirements.

The product uses Next.js/React, PostgreSQL with Drizzle and the BullMQ PostgreSQL backend, a Direct Meta adapter, and a separate secret-free browser runtime. There is no Redis and no alternative agent framework. Public target execution stays disabled until its required deployed gates pass. Local development binds the dashboard to loopback and identifies its explicitly enabled local workspace.

## Current implementation

The workspace saves sites through Drizzle/PostgreSQL and presents all three ownership methods. Verification helpers pin public DNS results at the TLS dial and reject redirects. GitHub/Better Auth schema migrations run; actual OAuth is not configured. Target credential references use authenticated encryption. Runs have persisted events, candidate findings, workflow history, report exports, cancellation and reserved spend. The PostgreSQL BullMQ worker/outbox and independent reaper run locally. Fly controller code exists. The image/control service now passes its actual owned-fixture browser-tool integration slice, with private artifact delivery.

The active tool loop validates Meta replies, commits intent before browser actions, checks generation/expiry/kill fences and accounts for ambiguous usage conservatively. The shared production/lab runner now drives the actual browser tools with Meta. Two autonomous owned-fixture workflows completed, with independent backing-store checks and a preserved stopped attempt. The admission gate remains closed. Runtime configuration is never treated as a passing integration test.

## Actual verification

- TypeScript passed and the production build completed. The dependency audit found an affected Drizzle 0.45.0 release; it was upgraded to patched 0.45.2 before publication.
- Twenty focused tests passed with explicitly synthetic model transport/browser observations.
- Four tests against a dedicated PostgreSQL test database passed: competing spend reservations/cancellation/unknown usage, actual BullMQ delivery/outbox deduplication, concurrent fresh fixture migration with state preservation, and development/public/judging funding isolation. No Redis.
- The owned Fieldwork fixture passed scripted HTTP registration/login/create/edit/cancel checks in both modes. Independent SQL confirmed the vulnerable negative-seat write and its rejection by the corrected mode, while the valid control remained functional.
- Direct Meta authentication and a real two-call tool protocol smoke passed. Model: muse-spark-1.3; accounted cost $0.004119. Its tool observation was synthetic and no website was scanned. See PROVIDER_SMOKE_TESTS.md.
- The dashboard rendered successfully. Saved-site persistence and ownership-method switching were checked in the browser. After a Docker restart, stale development chunks prevented hydration. Rebuilding the generated development cache restored interaction; the site dialog opens and focuses its name field. The screenshot is presentation evidence, not a full autonomous scan.

For reproducible SQL tests, create `oddhound_test` in the local PostgreSQL service, then run migrations and `pnpm test:integration` with DATABASE_URL pointing to that database. Tests refuse a database name without `_test`.

## Remaining implementation

The next slice completes explicit account/fixture/API grants and independent assertions with unchanged retests. Live demo admission/fixture isolation, all tenant/evidence/public-budget gates and deployment remain unfinished. Autonomous signup/login and unexpected writes have local owned-fixture evidence; general site compatibility remains unproved. Full atomic compute accounting and release attestations also remain unfinished; existing configuration checks are not proof of a funded containment profile.

Known planning risks still applicable include B01/B02 (image/provider profiles), B03/B04/B09/B18/B22/B23 (deployed browser isolation and policy), B06/B19 (autonomous rule/account/fixture behavior), B07/B21/B24/B26 (hosted recovery/accounting/limits), B08 (complete artifact/tenant protections), B20 (anonymous demo funding/isolation) and B27 (deployed access). The earlier audit's remaining closure gates are not waived. This is product implementation, not a new standalone blocker audit.

## Access and assumptions

Meta is configured locally and verified. GitHub repository access is available; product GitHub OAuth and Fly access are not configured. The vault key is local and ignored. No target credential was sent to Meta. No public site scan or Fly deployment occurred. The local product Chromium sandbox verdict passed; it does not establish a deployed verdict. The engineering replay and fixture checks are scripted and clearly labelled. Local database passwords are disposable development values, not production credentials.

Exact runtime/dependency versions are in VERSIONS.md. All changes, notes and evidence for this implementation stay in this repository.

## Browser implementation slice

The owned HTTPS lab passed 15 actual checks through the gateway, smokescreen and nftables. Registration, login, create/edit/cancel and an unexpected negative-seat write were checked against independent SQL. Actor contexts and fresh mobile contexts are separated. Captures are suppressed across contexts after credential preparation, and the private screenshot route checks owner binding. Explicit stop closed the browser and the guest exited successfully. The current and historical component records are retained in docs/evidence.

The local browser initially refused startup because its temporary profile was owned by the trusted launcher, then because the check expected an older chrome://sandbox label. The profile handoff and current label parser were fixed without disabling sandboxing. A separate static lab resolver was necessary because Docker NAT changes its embedded DNS port before filtering. Production does not enable lab destinations or that resolver. See BROWSER_RUNTIME.md for limits and reproduction.

Private PNGs are saved with size, dimension, hash and tenant checks; their blobs are removed from model text. The work also fences ambiguous action acknowledgements, scrubs known secrets from owner instructions, keeps stop control usable after inference cancellation and removes unused free-form fields from guest startup scope. These component protections do not close the full B07/B08/R1/R2 gates.

Local dashboard development uses Webpack polling to avoid stale Docker bind-mount chunks. The production build still uses the selected Next build path. All product code and notes remain in this folder.

## Autonomous product slice

The same orchestrator used by the Fly worker now runs actual Meta exploration in the explicitly isolated local lab. Two completed runs establish registration, returning login, valid create/edit/cancel and boundary exploration without selectors, click scripts or database feedback in the prompt. The vulnerable fixture yielded two candidates and independently persisted invalid seat values; the corrected comparison allowed valid controls and persisted no invalid seats. A first attempt stopped conservatively on an uncertain fill outcome; its evidence remains saved. See AUTONOMOUS_EXPLORATION.md.

Development funds now have their own $5 allocation and SQL-held/spent ledger. All three attempts total $2.216998 with no unknown usage. Public usage remains $0.004119 from the earlier protocol smoke, and no judging admission exists. Public input cannot select funding/priority. The dashboard separates development funding from the public quota and keeps candidate status explicit. Target credentials never enter model prompts; all model observations in this slice are sanitized text, with image inference still unavailable.

The number-field preflight reports native rejected text without dispatching the incompatible fill. Other ambiguous action acknowledgements still fence exploration. Browser closure uncertainty keeps the local slot finalizing; the Fly reaper excludes explicitly local lab runs. Local closure/exit and synthetic cleanup are verified, not substituted for Fly destruction.
