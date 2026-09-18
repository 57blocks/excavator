## D0 scope matrix

This matrix freezes the AI-first scope decision before production work. A product-code item is in scope only when it satisfies at least one design D0 reason: **S** = pre-model security/permission boundary, **D** = shared deterministic result, **P** = identity/freshness/persistence/coverage contract, **C** = workload cannot be performed reliably by the host agent at acceptable cost.

| Candidate implementation | D0 reason | Placement | Frozen boundary |
| --- | --- | --- | --- |
| Versioned pure selection policy and tagged decision | S, D, P | Product | Every candidate receives one deterministic pre-extraction decision; policy version participates in selection identity. |
| Sensitive extension and bounded private-key-header detection | S, D | Product | Detection must run before model or downstream access and cannot depend on prompt compliance. |
| Safe selection ledger and conservation merge | D, P | Product | Every candidate must land in exactly one machine-checkable bucket without protected content or content hashes. |
| Exact filename, basename-pattern, then extension language matching | D | Product | Registry and scanner consumers need one deterministic precedence rule. |
| Dockerfile basename patterns in the canonical language config | D | Product config | `Dockerfile.*` and `Dockerfile-*` are generic filename semantics, not a cebreo branch. |
| Directory/Git/MultiRepo selection before hash, materialize, read, search, and index | S, D, P | Product | A rejected path must not cross the materialization boundary; adapter outputs and digests must agree. |
| Root `.excavatorignore` as the sole project rule source | D, P | Product | HEAD-only Git and disk Directory adapters need the same authoritative, identity-bearing rule location. |
| Ordered digest over policy, root rules, CLI rules, and sensitive semantics | P | Product | Rule changes must invalidate stale deterministic artifacts even when source bytes are unchanged. |
| Discover cebreo/MAUI generated directories and propose project rules | none | Skill/prompt only | The host can inspect the project and existing scan manifests; no runtime profile, registry, or classifier is allowed. |
| Compare before/after manifests and explain why dropped files are safe | none | Skill/prompt only | This is project judgment over deterministic evidence, so no dedicated validator or product test module is allowed. |
| Framework discovery or C#/XAML/non-code readers | out of this change | Later scoped changes | This change must not pre-implement later capabilities. |

## Oracle mapping

| Frozen oracle | Boundary it protects | Expected result on pre-change `main` |
| --- | --- | --- |
| Fake private key canary plus byte-identical-size ordinary text | Sensitive input is rejected without rejecting ordinary text; persisted records are safe metadata only. | Red: the key is selected/materialized and no `sensitive` record exists. |
| Non-MAUI `bin/rails` | `bin/` is not a universal default. | Green; turns red if `bin/` is added globally. |
| Directory, Git, and MultiRepo copies of identical content | Same selected set and selection digest across adapters. | Red on the frozen safe set because all adapters currently select the key. |
| TypeScript and Dockerfile positive/negative matrix | Scanner and canonical registry agree; hyphen variants are recognized without matching `MyDockerfile-prod`. | Red on Dockerfile hyphen variants; TypeScript and negative controls stay green. |
| `unmc.zip` present/absent pair | Archives cannot affect selected paths or deterministic facts. | Green regression control. |

The oracle contains no MAUI/cebreo runtime configuration or test-only product module. Verify-the-instrument is explicit: the current missing sensitive/adapter filter is the deliberate bypass that makes the canary and adapter assertions red; running the `bin/rails` test with a temporary global `bin/` default must make that isolated guard red.
