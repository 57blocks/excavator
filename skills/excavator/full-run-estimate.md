# Full run estimate

Used by `/excavator --full --estimate`, at the end of Phase F2 step 2. Take
the counts from the files Phase F1 and Phase F2 steps 1–2 just wrote, apply
the measured rates below, and report. Dispatch nothing. Do the arithmetic in
the shell (for example with `awk`) rather than in your head.

## 1. Counts

```bash
INTER="$DATA_DIR/intermediate"
CACHE="$DATA_DIR/semantic-cache.json"; [ -f "$CACHE" ] || CACHE=/dev/null
```

- `G`: nodes Phase F2 will generate semantics for.
  `jq '.plan.generate | length' "$INTER/stale-semantics.json"`
- `B2`: Phase F2 batches. `jq '.totalBatches' "$INTER/batches.json"`. When
  step 1 found nothing stale, step 2 did not run: `B2` is 0. Do not read an
  older `batches.json` in that case.
- `V`: summaries Phase F4 will verify. These are the in-scope nodes with a
  line-range anchor that will get a new summary, plus the in-scope nodes with
  a fresh, non-empty summary that carries no verdict yet. File nodes have no
  line-range anchor and are never verified.

  ```bash
  jq -n --slurpfile sem "$INTER/stale-semantics.json" --slurpfile cache "$CACHE" '
    ($sem[0].plan.generate | map({key: .nodeId, value: true}) | from_entries) as $gen
    | ($sem[0].plan.reuse | map({key: .nodeId, value: true}) | from_entries) as $reuse
    | ($cache[0].entries // {}) as $e
    | [inputs | select(.record == "node") | .node | select(.lineRange != null)
       | select($gen[.id] or ($reuse[.id] and (($e[.id].summary // "") != "")
           and ((["verified", "unverified", "contradicted"] | index($e[.id].verification)) == null)))]
    | length' "$DATA_DIR/knowledge-graph.jsonl"
  ```

  With `--no-verify`, `V` is 0.
- `B4 = ceil(V / 30)`: Phase F4 batches. 30 is `prepare-semantic`'s default
  batch size.
- `F3`: 0 with `--scope`, otherwise 1.
- `N`: fact nodes in scope, `jq '.plan.counts.requested' "$INTER/stale-semantics.json"`,
  out of the graph's total, `jq -c 'select(.record == "node")' "$DATA_DIR/knowledge-graph.jsonl" | wc -l`.
- `D = B2 + B4 + 2 × F3`: subagent dispatches. Phase F3 dispatches the
  architecture analyzer and the assemble reviewer.

## 2. Formula

```text
cost_usd = 4.00 + 0.04 × D + 0.60 × B2 + 0.38 × B4 + 2.40 × F3
wall_min = 2.6 + F2_wall + 1.54 × B4 + 12 × F3
F2_wall  = 0 when B2 is 0, otherwise max(6, 1.24 × B2)
```

## 3. Rates and where they come from

| Item | Cost | Wall time |
|---|---|---|
| Fixed: orchestration, setup, Phase F1, Phase F5 | $4.00 + $0.04 per dispatch | 2.6 min |
| Phase F2, per batch | $0.60 | 1.24 min, at least 6 min |
| Phase F4, per batch | $0.38 | 1.54 min |
| Phase F3 | $2.40 | 12 min |

- **Model:** Sonnet. No other model has been measured. For another model,
  use these rates and say that they are Sonnet's.
- **Calibration:** one default Full run of an open-source Java EE application
  with 209 files: 19 Phase F2 batches, 28 Phase F4 batches, $30.42 and 85
  minutes. The run's self-reported cost is split by role in proportion to
  input-side tokens (cache read 0.1, cache write 1.25, uncached input 1).
  Output tokens cannot be split by role and follow the same proportion.
- **Check:** a 70-file fixture project run without Phase F4. Estimated $9.6
  against $8.47 actual (+14%), and 20.8 minutes against 26.2 (−21%). An
  earlier run of the same fixture, on older prompts, cost $6.32 (+53%) and is
  treated as an outlier.
- **Expected accuracy:** cost within ±30%, wall time within ±50%. Wall time
  depends on API latency and on how many subagents run at once. The same
  Phase F2 batch count has taken 6 minutes in one run and 14 in another.

## 4. Limits

- **`B2 + B4` above 100:** suggest splitting the run with `--scope`. The
  orchestrator's context grows by about 3.6k tokens per dispatch (from 85k to
  263k over 50 dispatches), so 100 dispatches reach about 450k. Every
  orchestrator turn reads its whole context, so cost grows roughly with the
  square of the dispatch count. Show where the nodes are, so the user can pick
  the scopes:

  ```bash
  jq -r '.plan.generate[].filePath | split("/")[:2] | join("/")' "$INTER/stale-semantics.json" \
    | sort | uniq -c | sort -rn | head -20
  ```

  When one directory holds most of the nodes, repeat one level deeper
  (`[:3]`).
- **Estimated wall time above 180 minutes:** that is the default timeout of
  an unattended runner. Suggest splitting with `--scope`, or re-running the
  same command after the run stops. A stopped Full run resumes from what it
  has committed.

## 5. Report

```text
Full run estimate (Sonnet rates; calibrated on a 209-file Java EE application, checked on a 70-file fixture)
Scope: <dir, or the whole project>
Fact nodes: <N> in scope, of <total>
Phase F2: <G> nodes to generate, <B2> batches
Phase F4: <V> summaries to verify, <B4> batches
Phase F3: runs | skipped (scoped run)
Subagent dispatches: <D>
Estimated cost: $<cost_usd> (±30%)
Estimated wall time: <wall_min> min (±50%)
<each limit that applies, with its suggestion>
```

Then **STOP**.
