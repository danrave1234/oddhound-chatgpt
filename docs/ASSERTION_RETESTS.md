# Independent numeric assertions and unchanged retests

Implemented on October 27, 2026. This is a supported deterministic check after exploration, not a general verifier for every model candidate. Public target execution remains disabled.

## Product behavior

The owner selects a saved candidate and approves an explicit business rule, numeric bounds, one invalid input, one valid neighboring input, exact observed control names, setup steps and a rendered-record locator. The `numeric_record_create_v1` template creates unique synthetic control/probe records, reloads the declared record view, and checks the displayed numeric values. The positive control must exist before the probe and remain afterward. A wrong page, missing or ambiguous control, ambiguous record or uncertain action cannot pass the check.

The entire assertion is parsed by a strict schema and hashed, including the origin, paths, rule, setup, exact locators, value extraction, bounds and both inputs. Retest uses that same JSON and SHA-256. It does not call a model, generate executable code or heal locators. A fresh run supplies only an explicit synthetic-name binding: `<approved namespace>_<run UUID first eight characters>`, followed by `_control` or `_probe`. The numeric template currently supports lowercase ASCII namespaces of 3–50 characters. The versioned template fixes this binding algorithm; changing semantics requires a new template version.

`finding_assertions` and completed attempt records reject updates in PostgreSQL. A finding's rule, assertion version and source run cannot change after approval. The owner-only API freezes the assertion and queues a new run only after replay-write acknowledgement, original grant-hash comparison, fresh authorization compilation, normal quotas and the runtime/public-launch gates. Ownership and selected account/API revisions are checked again by the worker. This template does not require a Meta connection during replay. Conservative normal run reservations are released by existing finalization; no model call is made.

Finding outcomes are separate from run outcomes. An independently reproduced violation changes a candidate to `verified / open`. A passing unchanged assertion with a preserved valid control changes a verified finding to `fixed`; a later failure becomes `regressed`. Blocked/inconclusive attempts preserve a previously verified lifecycle. Attempts are appended, never overwritten. A stopped, revoked or expired generation cannot commit a passing result. The reaper marks unanswered attempts inconclusive after their run ends.

Fix briefs label unverified rules as proposals. All target observations, titles, evidence and hypotheses are JSON data with delimiter characters escaped. They do not become trusted prompt instructions. Verified briefs identify the frozen hash and distinguish the rendered observation from a source-code explanation.

## Actual execution

The candidate came from the earlier real Meta discovery run `66c0734b-beba-4d77-814e-7a341bc64442`: `f580f282-c348-4a44-b949-0c98dbea251c`, “Create booking accepts out-of-range seat counts”. Its original discovery was autonomous. These subsequent checks are explicitly **scripted deterministic verification** with no new inference.

| Attempt | Actual result | Evidence |
|---|---|---|
| Fresh browser `9f29f2bb-e7bf-4f54-bfec-2352aee2fe2b` | Original assertion failed; rendered −1-seat record and preserved 3-seat control. Separate SQL confirmed both. Finding became verified/open. | [Verification](evidence/fixed-assertion-9f29f2bb-e7bf-4f54-bfec-2352aee2fe2b.json) |
| Fresh browser `75522ec9-472f-44e2-bbf1-b1eee72d366c` | Target switched to its corrected implementation at the **same HTTPS origin**. The unchanged assertion passed; SQL found only the valid 3-seat control. Finding became verified/fixed. | [Retest](evidence/fixed-assertion-75522ec9-472f-44e2-bbf1-b1eee72d366c.json) |
| Fresh browser `da814d01-3f88-4b15-8f8d-1f6862d57787` | The same assertion passed again on the final workspace-aware image build; independent SQL and closure checks passed. | [Final-image smoke](evidence/fixed-assertion-da814d01-3f88-4b15-8f8d-1f6862d57787.json) |

All three use assertion `ab42b4ea4f29e2befdc27c66c606a95165e0dc70e65f9226d6ac4fa279611ba8`. Browser closure was acknowledged and all containers exited 0. Chromium 156.0.8078.4 launched as UID 1101 with namespace and seccomp sandbox protection. Initial verification/retest and the 15 workflow/11 mapped regressions used local image `sha256:4a3f850ed587eda6fd1d9c40bacdd8f06b951d5a55436e3f7ecfb3a5b5c6b1a9`. The final image `sha256:ff2d1972f23ce953d7728001b17343cd4554959e46d1982d1dd08ad46f494bf8` includes the new workspace manifest in the frozen install and passed the third retest. [Image/test mapping](evidence/assertion-image.json) preserves both fingerprints. None is a Fly deployment verdict.

The first controller launches found missing ESM package boundaries before executing any assertion actions. Adding the checks workspace manifest and moving the owned fixture recipe into its ESM fixture package fixed those import errors. These failures are retained in [startup regression evidence](evidence/assertion-startup-regression.json); they are not passing runs.

## Verification and reproduction

The focused suite has 34 tests; six actual PostgreSQL integration tests pass. New coverage includes strict template validation, hash coverage, independent control preservation, missing/ambiguous locators, origin mismatch, fences, tenant access, database immutability, unsupported success evidence and open/fixed/regressed history. Unit browser replies are synthetic. The three rows above are actual browser, gateway, proxy, firewall, target and SQL execution.

Seven actual HTTP checks also pass: owner reads, original-finding linkage on a retest run, exported immutable recipe and failed/passing evidence, refusal of assertion replacement and cross-origin replay, closed runtime admission, and unchanged data after refused requests. [HTTP evidence](evidence/assertion-api.json) uses the explicit loopback development identity; it does not establish GitHub OAuth. Reproduce with PowerShell 7: `./tests/assertion-api.ps1 -FindingId <finding UUID> -RetestRunId <retest UUID>` after the owned checks. The UI shows the verified/fixed finding, frozen hash and append-only outcomes in [this screenshot](assets/assertion-retest.png).

With the owned lab TLS fixture and current browser image prepared as documented in BROWSER_RUNTIME.md:

```sh
docker compose run --rm setup pnpm exec tsx apps/browser/lab-prepare.ts
docker compose -f compose.yaml -f compose.browser-lab.yaml up -d fixture-lab browser-lab
docker compose -f compose.yaml -f compose.browser-lab.yaml run --rm browser-lab-controller pnpm exec tsx apps/worker/lab-assertion.ts --synthetic-candidate
# Set ODDHOUND_LAB_FIXTURE_CORRECTED=1 in the shell for the remaining commands.
docker compose run --rm setup pnpm exec tsx apps/browser/lab-prepare.ts
docker compose -f compose.yaml -f compose.browser-lab.yaml up -d fixture-lab browser-lab
docker compose -f compose.yaml -f compose.browser-lab.yaml run --rm browser-lab-controller pnpm exec tsx apps/worker/lab-assertion.ts --retest
```

CI uses the explicit synthetic-candidate flag. It does not fabricate an autonomous candidate, use a provider key or make paid calls. Local verification used the saved real Meta candidate through the explicit `--finding=<id>` flag. Every attempt gets a fresh browser; only the immutable assertion/finding identity carries across. Synthetic accounts and records created by the lab are removed afterward. Private control capabilities stay in ignored `data/` files.

## Limits and remaining work

- This checks a numeric **create form** and a fresh rendered record. Edit/cancel, authorization, accessibility and other findings still need supported templates; they remain candidates until proved. Owner review and exact setup configuration are currently required. Automatic conversion from discovery records into a reviewed recipe is unfinished.
- A target can misrepresent its own rendered state. The generic product claim is a rendered-record contradiction, not universal backend persistence. Independent SQL is an oracle available only in this owned evaluation app. Target-specific authenticated oracle/fixture integrations remain unfinished.
- A full account/tenant identity oracle, dynamic created-fixture bindings, stronger resource/deployed network proofs, atomic compute accounting, hosted queue recovery, retention/deletion and complete release attestations remain open. Production GitHub OAuth and Fly credentials are unavailable; no public-site scan or launch occurred.
- The local dashboard's retest action uses the real admission path and therefore remains closed while the public/runtime gate is closed. The explicit owned lab controller demonstrates the actual checker and persistence without bypassing public target admission. No additional root Plan Audit ID is claimed closed.
