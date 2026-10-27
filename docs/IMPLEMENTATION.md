# Implementation

All product source, tests and implementation notes live in this directory. The parent AGENTS.md and its owning specifications supply the product requirements.

The product uses Next.js/React, PostgreSQL with Drizzle and the BullMQ PostgreSQL backend, a Direct Meta adapter, and a separate secret-free browser runtime. There is no Redis and no alternative agent framework. Public target execution stays disabled until its required deployed gates pass. Local development binds the dashboard to loopback and identifies its explicitly enabled local workspace.

## Current implementation

Browser compute now has an atomic SQL reservation/settlement ledger rather than an environment-only balance comparison. One creation attempt, conservative unknown holds, overdue-provisioning disablement and cleanup independent of pricing/admission are implemented. The production allocation remains unconfigured; tests use synthetic rates/provider responses against real local and hosted SQL. See [COMPUTE_ACCOUNTING.md](COMPUTE_ACCOUNTING.md). Current results: 39 focused tests, 12 local SQL integration tests and 12 hosted SQL integration tests; no extra inference or complete runtime clearance is claimed.

The hosted Next.js preview is deployed on Vercel Hobby with actual Node v26.12.1, Neon Free PostgreSQL connected and the Fly queue worker online. The independent Fly reaper passed an actual controller-exit-before-Machine-ID-persistence case, removing the orphan before guest expiry and retaining capacity through the unknown-create window. Fresh-browser sandbox/private-control/native-egress checks and ten hosted SQL integration tests also pass. Private screenshots use shared PostgreSQL storage; timeline responses are bounded. [HOSTED_EXECUTION.md](HOSTED_EXECUTION.md) owns these component proofs and their limits. Full GitHub browser sign-in and a hosted Meta/browser product run remain pending; public execution stays closed.

The local live-demo entry point is now connected to durable admission, a supervised host launcher and the same Meta/browser/checker modules. The UI completed a real 55-action/56-turn Meta run for $1.068351, independently verified its negative-seat finding, and passed the same assertion on the corrected owned target. Both checker runs had zero model spend. Actual browser removal gates finalization; a failed launch before inference is preserved and refunded. See CONNECTED_MVP.md for the interface and evidence. This is an explicit development-only owned-fixture profile, not public-site launch clearance.

The workspace saves sites through Drizzle/PostgreSQL and presents all three ownership methods. Verification helpers pin public DNS results at the TLS dial and reject redirects. GitHub/Better Auth schema migrations run; OAuth variables and the authorization redirect are configured, while full sign-in remains unverified. Target credential references use authenticated encryption. Runs have persisted events, candidate findings, workflow history, report exports, cancellation and reserved spend. The PostgreSQL BullMQ worker/outbox and independent reaper run locally. Fly controller code exists. The image/control service passes the owned-fixture browser-tool integration slice, with private artifact delivery.

The active tool loop validates Meta replies, commits intent before browser actions, checks generation/expiry/kill fences and accounts for ambiguous usage conservatively. The shared production/lab runner now drives the actual browser tools with Meta. Two autonomous owned-fixture workflows completed, with independent backing-store checks and a preserved stopped attempt. The admission gate remains closed. Runtime configuration is never treated as a passing integration test.

## Actual verification

- TypeScript passed and the production build completed. The dependency audit found an affected Drizzle 0.45.0 release; it was upgraded to patched 0.45.2 before publication.
- Thirty-four focused tests passed with explicitly synthetic model transport/browser observations.
- Six tests against a dedicated PostgreSQL test database passed: competing spend reservations/cancellation/unknown usage, actual BullMQ delivery/outbox deduplication, concurrent fresh fixture migration with state preservation, development/public/judging funding isolation, and immutable authority/credential and API revocation. No Redis.
- The owned Fieldwork fixture passed scripted HTTP registration/login/create/edit/cancel checks in both modes. Independent SQL confirmed the vulnerable negative-seat write and its rejection by the corrected mode, while the valid control remained functional.
- Direct Meta authentication and a real two-call tool protocol smoke passed. Model: muse-spark-1.3; accounted cost $0.004119. Its tool observation was synthetic and no website was scanned. See PROVIDER_SMOKE_TESTS.md.
- The dashboard rendered successfully. Saved-site persistence and ownership-method switching were checked in the browser. After a Docker restart, stale development chunks prevented hydration. Rebuilding the generated development cache restored interaction; the site dialog opens and focuses its name field. The screenshot is presentation evidence, not a full autonomous scan.

For reproducible SQL tests, create `oddhound_test` in the local PostgreSQL service, then run migrations and `pnpm test:integration` with DATABASE_URL pointing to that database. Tests refuse a database name without `_test`.

## Remaining implementation

The numeric-create assertion template and unchanged retest are implemented and pass on the owned target; see ASSERTION_RETESTS.md. Additional templates and automated recipe capture remain unfinished. Typed account/API grants are implemented; dynamic fixture bindings and the remaining actor/registration semantics still need their proofs. Live demo admission/fixture isolation, all tenant/evidence/public-budget gates and deployment remain unfinished. Autonomous signup/login and unexpected writes have local owned-fixture evidence; general site compatibility remains unproved. Full atomic compute accounting and release attestations also remain unfinished; existing configuration checks are not proof of a funded containment profile.

Known planning risks still applicable include B01/B02 (image/provider profiles), B03/B04/B09/B18/B22/B23 (deployed browser isolation and policy), B06/B19 (autonomous rule/account/fixture behavior), B07/B21/B24/B26 (hosted recovery/accounting/limits), B08 (complete artifact/tenant protections), B20 (anonymous demo funding/isolation) and B27 (deployed access). The earlier audit's remaining closure gates are not waived. This is product implementation, not a new standalone blocker audit.

## Access and assumptions

The numeric-assertion slice adds an owner-approved, immutable recipe/rule with a deterministic rendered-record oracle. One saved real Meta candidate was verified, then fixed by a passing unchanged assertion with its valid control intact. Missing controls and uncertain evidence do not become passes. Reports include the original recipe and recent immutable attempts; the seven-check HTTP smoke validates owner reads, report export, immutability, request-origin refusal and closed admission. It uses the explicit local identity, not GitHub OAuth. See ASSERTION_RETESTS.md for actual browser/SQL evidence and the remaining template/oracle limitations.

Meta authentication is verified locally and from the actual Fly worker; the deployed check only listed models and made no inference call. GitHub repository access and the hosted OAuth redirect work; the full human browser sign-in check remains pending. Platform keys are in encrypted provider configuration and ignored local files, never in the browser app. No target credential was sent to Meta. No public site scan or complete Fly profile clearance occurred. Chromium sandboxing is positively verified locally and on Fly under UID 1101, and one deployed controller-crash cleanup case passes. The engineering replay and fixture checks are scripted and clearly labelled. Local database passwords are disposable development values, not production credentials.

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

## Owner contract slice

Run setup now selects actor-specific credential references and freezes API proofs, methods, namespaces, test IDs, denied paths, cleanup and production write acknowledgement. Canonical snapshot hashes survive PostgreSQL JSON key order, and a database trigger rejects scope/owner/site/goal rewrites. Queued credential rotation or site/API revocation fences affected runs and releases unstarted reservations/quota. Active generations are fenced, with the existing dispatch/termination race gates still pending. The worker rechecks all selected origin/credential revisions and decrypts only approved references.

The guest enforces selected roles/references and a mapped request policy for origin/method/path plus form/JSON namespace or fixture-ID bindings. Its conservative mapped registration-request slots are not a proof of all successful-account caps under arbitrary broad-staging behavior. Four pure Python tests and eleven actual request canaries pass. SQL sees four expected allowed writes and two permitted CORS preflights; denied nonces do not arrive. The existing fifteen browser workflow checks still pass. No new Meta call or Fly deployment occurred. RUN_AUTHORIZATION.md owns this slice�s evidence, reproduction and limits.
