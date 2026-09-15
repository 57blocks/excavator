## 1. Freeze the reuse oracle

- [x] 1.1 Acceptor writes the pre-implementation oracle for duplicate, fresh, missing, stale, noncanonical, unknown-node, and path-not-in-manifest inputs; verify every unique requested node lands in exactly one expected bucket and the expected counts conserve the input.
- [x] 1.2 Coder adds the red planner and execution fixtures before production edits; verify the current code has no single reuse plan, and an all-fresh simulated answer path can detect any generator/writer call or cache-byte change.

## 2. Implement deterministic reuse before generation

- [x] 2.1 Coder implements the pure reuse planner using the existing canonical-entry and freshness gates; verify deduplication, terminal reasons, count conservation, selective single-file invalidation, stable output, and zero mutation of every supplied input.
- [x] 2.2 Coder adds the thin read-only planner CLI over current `knowledge-graph.json`, `source-manifest.json`, and `semantic-cache.json`; verify safe repeated node-id arguments, current artifact reads, visible unavailable/failure output, no writer import, and byte-identical project/source/cache artifacts.
- [x] 2.3 Coder updates `excavator-chat` to choose its bounded need set, invoke the planner before semantic generation, use `reuse[]` only as seeds, and iterate only `generate[]`; verify all-fresh performs zero generation/write, overlap preserves intersection entry bytes/provenance, unavailable nodes degrade visibly, answer claims still require current evidence, and runtime skill prose contains current behavior without OpenSpec/change-history annotations.
- [x] 2.4 Coder extends the focused integration fixture through plan → source verification → conditional commit; verify one changed file regenerates only its needed entries, a post-plan hash drift is rejected by the existing CAS gate without blocking the answer, and `knowledge-graph.json` remains byte-identical.
- [ ] 2.5 Acceptor independently reviews the implementation against `semantic-cache-reuse/spec.md`; verify the frozen red fixtures are green, no second freshness authority or persisted hit telemetry was introduced, and no exploration-memory, broad-query, traversal-budget, or concurrent in-flight dedupe behavior was bundled.

## 3. Validate sequential reuse and close the change

- [ ] 3.1 Run all focused semantic-cache/reuse/language/Chat tests; verify they exit 0 and assert actual bucket reasons, generator/writer call counts, whole-cache SHA, per-entry byte/provenance equality, selective invalidation, and fact-graph immutability.
- [ ] 3.2 On pinned Conduit commit `5e127d8569b300e0a21dc2c20ea680da4967b1aa`, build a canonical cache with “收藏文章是怎么实现的”, repeat it in a new session, then ask an English overlapping question; verify the repeat leaves the whole cache SHA unchanged, the overlap preserves every intersection entry byte while adding only its needed difference, answers use Chinese then English, identifiers remain verbatim, and all claims are checked against current source.
- [ ] 3.3 Run `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm test`; verify every command exits 0, existing conditional skips do not increase, and no suite is deleted or weakened.
- [ ] 3.4 Run `openspec validate --strict semantic-cache-reuse` and `git diff --check`; verify both exit 0 and the Excavator diff contains no unrelated user edits, Conduit source, or real-project `.excavator` output.
