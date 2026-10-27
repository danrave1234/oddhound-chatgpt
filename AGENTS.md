# Oddhound implementation

Keep all source, tests, evidence and notes for this implementation inside this folder. Parent owner specifications remain requirements; do not edit parent notes. Work independently; do not inspect or reference other implementations.

The user ended the standalone blocker-audit phase and authorized implementation of the entire product. Build usable complete slices and verify their behavior. Do not resume an audit-only workstream. Tests that establish the behavior of code being built are part of implementation. The standalone repository's product requirements are in docs/SPECIFICATION.md.

Run JavaScript with the pinned Node 26 Docker runtime. Use the PostgreSQL BullMQ backend explicitly; never Redis. Public execution remains closed until the applicable deployed profile is proved. Meta access and two real tool calls are verified; 14 scripted browser-tool checks and the local non-root Chromium sandbox pass; the key is local and ignored by Git. Product GitHub OAuth and Fly credentials are not configured. Do not fabricate integration results or substitute another model. Synthetic recorded replies belong only in tests. Keep actual runtime status separate from configuration.

After each complete slice, update docs/IMPLEMENTATION.md and docs/VERSIONS.md with actual results and remaining work. Keep the live workspace available at localhost:3000 during local development. Use the existing shared Docker database/dependencies volumes without deleting unrelated data.
