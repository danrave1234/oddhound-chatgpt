# Disposable browser service

This implementation now runs real browser tools behind the selected gateway candidate. It has not been deployed on Fly or cleared for public active testing.

The trusted controller creates the private control capability. The guest has no platform key or database connection. Its root supervisor starts smokescreen, the mitmproxy policy and nftables before launching Chromium as UID 1101 with its sandbox enabled. The Chrome launcher receives a clean environment and an exclusively owned temporary profile. Control is bound to the exact private address and admitted source addresses; neither readiness nor browser observations reveal its capability.

Tools discover current visible controls and retain trusted element handles. The model supplies validated actions and opaque control references, never selectors, JavaScript or shell. Actor contexts and fresh mobile contexts have separate session state. Generated identities return credential references. Screenshots are withheld across contexts once credential values are present; sanitized text and action observations remain available.

The gateway permits approved same-origin writes and separately declared API methods, with verified-UI Origin required for additional API authority. Resource origins do not gain tool navigation or API authority. WebSocket upgrades remain disabled in this profile. HTTP bodies, request counts, concurrency, admitted upstream IP bytes and artifacts are bounded. TLS is intercepted by a fresh run-local trust root; upstream verification remains enabled. Accept-Encoding is changed to identity; an origin ignoring it is currently refused. These compatibility limitations are explicit and must not be reported as original-site certificate defects.

The controller saves bounded PNG artifacts privately and serves them only through an owner-bound route with restrictive content headers. Artifact IDs are created by trusted code; guest filenames are never used. The model receives sanitized observations without PNG blobs. Screenshot inference still needs its separate provider/price proof.

## Actual component result

Fourteen scripted checks passed on the owned internal HTTPS fixture: sandbox status, page discovery, private screenshot/tenant access, foreign UI refusal, credential references/pixel suppression, real signup/login, create/edit/cancel with independent SQL reads, an unexpected boundary write, role separation, fresh mobile state, prepared-identity cap and browser closure. The current record is [here](evidence/browser-tools-lab.json). Historical failure and passing records are retained.

Chromium 156 reports Layer 1 Sandbox = Namespace, PID namespaces = Yes, Network namespaces = Yes and Seccomp-BPF sandbox = Yes. UID is 1101. The earlier startup failure was a temporary profile ownership error; the next false rejection came from expecting an older status-page label. Both were fixed without disabling Chromium's sandbox.

The owned lab uses two explicit private fixture destinations and a static internal DNS fixture. Docker's embedded resolver uses NAT port translation, so it could not use the production-style exact port exception. Production does not use the lab resolver or private destination exceptions and refuses the lab profile on Fly. The normal runtime controller also refuses a lab readiness profile. No public URL is admitted through this harness.

These results establish component behavior, not autonomous discovery, the full R1 network matrix, all SELF gates, deployed containment or real-site compatibility. Account/fixture operation grants, public/anonymous funding, image inference, complete retests and Fly lifecycle proof remain separate work.

Later, [two real Meta-driven workflows](AUTONOMOUS_EXPLORATION.md) completed through the same product tool path. A number-field rejection regression brings the scripted suite to 15 passing checks. The full network/deployment and release limitations above still apply.

## Reproduce locally

After the main setup and fixture bootstrap in README:

1. Build `apps/browser/Dockerfile` as `oddhound-product-browser:development`.
2. Create a short-lived owned lab certificate in ignored `data/lab-tls`, using the exact certificate command in the CI workflow.
3. Run `docker compose run --rm setup pnpm exec tsx apps/browser/lab-prepare.ts`.
4. Start `dns-lab`, `fixture-lab`, `fixture-corrected-lab` and `browser-lab` using both Compose files.
5. Run the `browser-lab-controller` service using both Compose files. It calls no model and cleans its synthetic accounts and bookings.

Create a new prepared run and fresh browser container for another run. Never resume a browser/profile from a prior run. CI uses the same commands against a fresh job environment.

The first browser CI run passed the sandbox check but failed initial page discovery ([run 40455049332](https://github.com/danrave1234/oddhound-chatgpt/actions/runs/40455049332)). Its logs did not establish the page failure's exact cause. The lab now waits for certificate-validated HTTPS fixture readiness before browser startup, serializes concurrent schema migration in PostgreSQL, and saves a bounded initial-document summary for diagnosis. A fresh-schema concurrency integration test and all 14 local browser checks pass after these changes; GitHub confirmation is recorded separately.

Typed owner contracts and the mapped request-body policy now have [separate component evidence](RUN_AUTHORIZATION.md). The existing 15 workflow checks and 11 mapped canaries pass. Automatic request-body streaming is disabled so authorization sees the bounded body before forwarding. This does not close the broader resource, application-semantics or deployed gates.
