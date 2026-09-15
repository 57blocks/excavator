# Semantic cache reuse — frozen acceptance oracle

Frozen before production/test implementation: 2026-09-15.
Authority: all four change artifacts and AGENTS.md, read completely.
This oracle specifies observable behavior; existing canonical/audit/freshness
and short-lock/CAS gates remain authoritative. No second freshness rule.

## 1. Exact synthetic fixture and expected matrix

Use temporary synthetic projects. Source strings are UTF-8 with final newline.
`H(text)` means lowercase SHA-256 hex of those exact bytes.

```text
SAME = "export function save() { return 1; }\n"
LOAD = "export function load() { return 3; }\n"
REMOVE = "export function remove() { return 4; }\n"
OUTSIDE = "export function outside() { return 5; }\n"
SHARED_0 = "export class OwnerA { save() { return 0; } }\nexport class OwnerB { save() { return 2; } }\n"
SHARED_1 = "export class OwnerA { save() { return 1; } }\nexport class OwnerB { save() { return 2; } }\n"
SHARED_2 = "export class OwnerA { save() { return 10; } }\nexport class OwnerB { save() { return 2; } }\n"
SHARED_3 = "export class OwnerA { save() { return 20; } }\nexport class OwnerB { save() { return 2; } }\n"
```

Graph nodes have the exact ids/paths below. Manifest contains A/B/M/S/N paths
with hashes of SAME/SAME/LOAD/SHARED_1/REMOVE. O exists in source and graph but
not manifest; U has no graph node. S and T share one manifest path.

`E(hash)` is `{summary: 'Returns a local value.', tags: ['value'],
semanticSourceHash: hash, model: 'oracle-seed-model',
generatedAt: '2026-09-01T00:00:00.000Z'}`, plus the accepted content-bound
`languageAudit` from existing `auditSemanticCacheFields({fields})`.
Assert seed audit acceptance first; do not manufacture an accepted digest.
Base cache is `{version: '2.0.0', contentLanguage: 'en', entries: ...}`.

| Alias / exact node id | Graph path | Seed entry | Expected requested outcome |
| --- | --- | --- | --- |
| A / `function:src/same-a.ts:save()` | `src/same-a.ts` | E(H(SAME)) | reuse / fresh |
| B / `function:src/same-b.ts:save()` | `src/same-b.ts` | E(H(SAME)) | reuse / fresh |
| M / `function:src/missing.ts:load()` | `src/missing.ts` | absent | generate / missing |
| S / `method:src/shared.ts:OwnerA.save()` | `src/shared.ts` | E(H(SHARED_0)) | generate / stale |
| T / `method:src/shared.ts:OwnerB.save()` | `src/shared.ts` | E(H(SHARED_0)) | unrequested in main matrix |
| N / `function:src/noncanonical.ts:remove()` | `src/noncanonical.ts` | E(H(REMOVE)), then change only summary to `移除条目。` | generate / noncanonical-language |
| O / `function:src/outside.ts:outside()` | `src/outside.ts` | E(H(OUTSIDE)) | unavailable / path-not-in-manifest |
| U / `function:src/unknown.ts:unknown()` | absent | E(H(SAME)) | unavailable / unknown-node |

Exact request: `[S,A,M,A,N,U,O,B,S,B]`.
First-occurrence unique order: `[S,A,M,N,U,O,B]`.
Exact bucket order: reuse `[A,B]`; generate `[S,M,N]`; unavailable `[U,O]`.
Exact reasons follow the matrix; counts are
`requested=7, reuse=2, generate=3, unavailable=2`, satisfying `7=2+3+2`.
Assert exact membership/reasons, pairwise disjointness, union equality, and
one occurrence per unique id. T stays absent. Known paths are exact; U has
explicit JSON-visible missing path, never an invented path. Generate carries
the current manifest hash; S carries H(SHARED_1), not its cached old hash.

## 2. Planner and CLI invariants

1. Identity/order: `[A,B,A]` yields reuse `[A,B]`, counts `(2,2,0,0)`,
   despite identical content/hash/name. Reseed S/T at H(SHARED_1):
   `[T,S,T]` yields reuse `[T,S]`; same names in different owners stay distinct.
   Empty input yields empty buckets/counts. Repeated calls and reordered
   graph/manifest/cache storage produce identical request-ordered JSON.
2. Canonical authority: request `[A,M]` after removing cache language, setting
   it to zh, or setting version to 1.0.0: generate
   `[A:noncanonical-language,M:missing]`, counts `(2,0,2,0)`.
   Missing audit, pre-digest audit, changed prose after audit, or object summary
   makes A noncanonical. Missing semanticSourceHash makes A missing.
   Both unaudited and stale yields noncanonical, following existing precedence.
   Pass the complete cache to the existing read gate, including version.
3. Immutability: recursively freeze all supplied arrays/objects, including
   nested tags/audits/graph fields; compare deep snapshots afterward.
   Valid calls succeed without mutation, in-place sorting, consumption, or stamps.
4. CLI: materialize the matrix; repeated node-id argv yields the same JSON.
   Test a literal id/path containing spaces and `;$(touch ORACLE_SHOULD_NOT_EXIST)`
   using argument-array invocation: exact identity survives, no marker appears.
   CLI does not import/call the writer entry point; using the existing shared
   module's read exports is allowed. No shell evaluation or model invocation.
5. Fresh disk reads: between invocations change A source/manifest hash: A stale,
   B fresh. Remove A from graph: unknown-node. Restore graph, remove manifest
   path: path-not-in-manifest. Missing cache means available nodes are missing;
   it creates no file. Required-artifact failures must be visible and tested,
   with no invented reuse/omitted ids. Corrupt cache follows existing read
   fallback or visible failure, never silently fresh. Compare raw bytes/SHA
   and file inventory before/after each invocation: graph, manifest, cache,
   source unchanged; no lock, temporary artifact, or telemetry file appears.

## 3. Execution and evidence invariants

1. All fresh: base cache, request `[B,A,B]`; reuse `[B,A]`, counts `(2,2,0,0)`.
   Exercise plan → current-source verification → answer. Generator spy=0,
   writer spy=0, lock calls=0; even no-op/rejected calls count. Whole-cache
   bytes/SHA and every entry's bytes/model/generatedAt/audit remain unchanged,
   including unrelated stale/noncanonical entries. New process reads repeat
   the result without conversation memory. Source verification still occurs.
2. Overlap: separate canonical writer-normalized baseline with fresh A/B/T,
   T at H(SHARED_1), M absent. Earlier need set `[A,B]`; request `[B,M,A,M]`.
   Reuse `[B,A]`; generate `[M:missing]`; counts `(3,2,1,0)`.
   Generator/writer id logs both exactly `[M]`; verify local source and commit
   through the existing writer. Final keys exactly A/B/T/M; A/B/T entry bytes
   and provenance unchanged; M fresh; whole SHA changes. Repeating yields all
   reuse/zero calls/stable new SHA. Adding U/O reports both unavailable and
   never generates them. Compare entry serialization without sorting/dropping
   metadata; use exact entry text from the writer-normalized baseline.
3. Selective stale: reset fresh A/B/S/T at SHARED_1, change shared source and
   manifest to SHARED_2. Request `[S,B]`: S stale, B fresh, counts `(2,1,1,0)`;
   only S generates/writes; unrequested T unchanged. Separate reset request
   `[T,B,S]`: T/S stale, B fresh, counts `(3,1,2,0)`, although OwnerB text did
   not change. No symbol-level invalidation. Unchanged-file entries stay exact.
4. CAS drift: plan/generate S at H(SHARED_2), then change source/manifest to
   SHARED_3 before existing writer submission with the planned old hash.
   Expect existing stale/CAS failure, unchanged cache bytes, no falsely fresh
   entry, and replanning still requires generation. Answer continues with
   visible cache failure; affected claims are rechecked or qualified.
5. Evidence/language: give A a properly audited fresh summary
   `Sends an email before saving.` while source remains SAME. Planner reuses;
   current-source verification precedes claims. Drop/qualify the unsupported
   email claim; `save` returning 1 needs current source evidence. Generator/
   writer remain zero, cache/provenance unchanged. Facts/source are never
   modified to support cached prose. Chinese then English requests produce
   corresponding answer languages, verbatim identifiers, no translated cache.
   All execution cases preserve graph bytes. Only verified, eligible generate
   items may commit; inability to verify is visible, never fabricated success.

## 4. Red tests and strict real-session acceptance

1. Before production edits, commit executable red planner/execution fixtures.
   Record command/status/assertion failures. Import absence alone cannot prove
   execution detection. Known false controls must be rejected: omitted U,
   duplicate A across buckets, wrong S reason, identity collapse, one generator
   call, one no-op writer call, provenance-only edit, whitespace-only rewrite,
   and unsupported email claim. Do not skip/weaken tests or use a test-only
   empty loop as proof that the actual host execution contract is followed.
2. Pin disposable Conduit HEAD to `5e127d8569b300e0a21dc2c20ea680da4967b1aa`.
   From clean canonical cache ask `收藏文章是怎么实现的`; record bounded need set
   N0, plan, source checks, generation/commit ids, SHA and entry provenance.
3. New session: repeat exactly that question using recorded fixed need set N0.
   All entries must reuse; generation/writer logs empty; whole SHA and entry
   bytes/provenance identical. Recheck current evidence. Design permits newly
   discovered need ids, while task 3.2 requires unchanged SHA: record discoveries
   separately; a growing natural need set proves intersection reuse only,
   not the strict fixed-set replay. Never omit needed nodes to claim success.
4. Another new session: ask `How are articles favorited and unfavorited, and how
   is the favorites count returned?`. Record actual need set N1. Fresh
   intersection stays byte-identical; only needed generate difference commits.
   Require a recorded nonempty difference to establish real overlap generation;
   otherwise that case remains unproven. Chinese/English answers keep identifiers
   verbatim and every code/business claim has current evidence.
5. Focused tests, install/build/test, strict OpenSpec validation, and diff check
   must pass; skips cannot increase and tests cannot weaken. Report synthetic
   mechanism and real host evidence separately, false claims separately from
   omissions. Real source/paths/.excavator outputs are never committed.

## 5. Explicit non-goals

No in-flight dedupe, leases, pending states, long generation locks, exploration
memory, saved queries/answers/flows, broad-query splitting/exhaustive traversal,
or changes to 80-node/160-edge budgets. No schema/version, manifest, node-id,
fact-graph, or language-contract changes. No second freshness authority,
symbol hashes, persisted hit counters/lastUsedAt, timestamp/audit restamping,
or telemetry. Simultaneous first misses may both generate. Runtime skill prose
states current behavior without OpenSpec/change-history annotations.
