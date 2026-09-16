# MCP acceptance oracle (frozen before implementation)

The red control is `EXCAVATOR_ORACLE_BAD=1 pnpm exec vitest run tests/mcp/contract-oracle.test.mjs`. It injects a fake eight-tool list with an `answer_question` tool and must fail the exact-seven assertion. The normal test must pass. This demonstrates that the discovery oracle can see an unwanted capability before it is used on the real server.

Observed 2026-09-16: red control exited 1 (`1 failed | 1 passed`), and the diff identified the extra `answer_question` tool at `tests/mcp/contract-oracle.test.mjs:14`. The prior exit 254 (`vitest not found`) was only an uninstalled-worktree setup failure; `pnpm install --frozen-lockfile` fixed it before the real control run.

| Boundary | Passing evidence | Known failure |
| --- | --- | --- |
| Surface | Real MCP client handshake and tools/list returns exactly `project_status`, `sync_facts`, `recall`, `traverse`, `read_evidence`, `semantic_plan`, `semantic_commit` | Extra `answer_question`, arbitrary command, missing tool, wrong schema |
| Model ownership | All seven tools function with model credentials absent; no provider calls in server | Provider key required, generated summary/translation/answer returned by server |
| Snapshot and completeness | Every read/write result has current comparable snapshot identity, freshness, visible gaps and error bucket; bounded tools expose usage, truncation and continuation boundary | Missing snapshot, silent cutoff, stale data called fresh, unknown input dropped |
| Containment | Canonical relative source paths, realpath stays under bound root, `.excavator` write target stays under root | `..`, absolute path, external symlink, symlinked `.excavator` accepted |
| One semantic cache | Lazy/Full/MCP plan same node buckets and use one writer; fresh repeat makes zero generation/writer calls and cache SHA/provenance unchanged | Parallel cache, same-hash rewrite, stale-hash commit, forged node/path commit |
| Identity and negative fixture | Same bytes at different paths are distinct; same name under different owners is distinct; missing/stale/noncanonical/fresh each has one bucket | Path or name conflation; implicit fourth state |
| Real acceptance | wcp and cebreo local data; cold/repeat/overlap/update/budget; model work attributed to host; fabrication and omission counted separately | Claims unsupported by current evidence; generated project data committed |

No automated oracle substitutes for checking the final host answer against current source evidence. A pass on protocol shape alone is not a claim of semantic correctness.
