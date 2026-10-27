# Direct Meta smoke results

October 27, 2026: authenticated GET `/v1/models` returned HTTP 200 and listed `muse-spark-1.3`. The real adapter then completed two actual requests: `observe`, followed by a synthetic tool result and `finish_run`. The exact assistant tool-call response was replayed. No browser or target website was used.

| Attempt | Prompt tokens | Completion tokens | Accounted cost |
|---|---:|---:|---:|
| observe | 1,032 | 134 | $0.001860 |
| finish_run | 1,127 | 200 | $0.002259 |
| Total | 2,159 | 334 | **$0.004119** |

The SQL ledger reserved up to $0.10, settled reported usage and released unused funds. No usage remains unknown. Costs use uncached Standard rates of $1.25/M input and $4.25/M output, checked against [Meta's model page](https://dev.meta.ai/models/muse-spark). Accounted cost is not an independent invoice reconciliation.

Sanitized machine-readable records: [access](evidence/meta-access.json) and [protocol](evidence/meta-protocol.json). Credentials exist only in ignored local environment configuration. Unit tests use synthetic transport replies and do not call Meta. No backup provider, screenshot inference, autonomous exploration, Fly deployment or real-site scan is claimed by this protocol smoke.

Subsequent [autonomous browser runs](AUTONOMOUS_EXPLORATION.md) use the same real model against the owned HTTPS fixture. Two completed workflows and a preserved stopped attempt account for a further $2.216998 in the separate development ledger. All 144 calls have reported usage; no reservation remains unknown. Those runs use sanitized text/control observations, not screenshot inference. See the [actual ledger extract](evidence/autonomy-ledger.json).
