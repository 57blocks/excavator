## 1. Freeze the routing oracle

- [x] 1.1 Acceptor (Opus) freezes the exact local, flow, and inventory questions plus expected query plan, post-recall seed/target selection, budgets, segmented-flow boundaries, and inventory availability before production edits; verify the oracle separately scores top-20 recall, top-5 traversal seeds, graph boundary, evidence coverage, and unsupported path/completeness claims.
- [x] 1.2 Coder (Sonnet) adds fake query-plan/executor fixtures and verifies the current policy fails because `local-condition + bounded-bfs`, more than 5 or out-of-recall seed ids, missing shortest-path targets, a fabricated continuous cross-protocol path, and a single inventory graph flood are not all rejected.

## 2. Route before graph expansion

- [x] 2.1 Coder implements a structured query-plan validator/executor for the closed intent/primitive enums, compatibility matrix, `terms`, `recallLimit`, `hopLimit`, `maxNodes`, `maxEdges`, and `maxContextTokens`; verify it rejects incompatible intent/primitive pairs, unknown enums, shortest paths above 6 hops, or budgets above 80 nodes/160 edges/12,000 tokens before graph execution.
- [ ] 2.2 Coder updates `skills/excavator-chat/SKILL.md` with the ordered intent contract; verify the frozen publish-field question selects local/source-first, the editor-to-database question selects bounded segmented flow, an explicit A→B question selects shortest path, and direct-caller questions select 1-hop.
- [ ] 2.3 Coder separates candidate recall from traversal execution selection; verify 20 recalled candidates remain available for evidence lookup, `seedNodeIds`/`targetNodeIds` are deduplicated current graph identities drawn from the recall pool, at most 5 intent-relevant candidates become graph seeds, shortest-path has both endpoint sets, and source-first/inventory has neither.
- [ ] 2.4 Coder adds inventory/Domain routing and structured boundary reporting; verify all-process requests never start one full-repository BFS, missing inventory returns `inventory-unavailable` plus coverage/gaps, and traversal reports reason/truncated, actual budgets, recall count, seed/target ids, covered nodes, uncovered candidates, and gaps without claiming completeness.
- [ ] 2.5 Coder updates Chat flow execution and evidence gates; verify HTTP/API or other fact-graph breaks become explicit source-verified bridges between separately bounded fact segments, no continuous/directed graph path is fabricated, stale navigation candidates enter visible gaps, and frontend UI validation is distinguished from backend enforcement.
- [ ] 2.6 Acceptor independently reviews the implementation against `query-scope-routing/spec.md`; verify the red fixtures are green, deterministic fact-edge restrictions and existing undirected traversal semantics remain intact, and no adaptive-memory persistence, protocol-edge synthesis, or directional graph rewrite was bundled.

## 3. Validate on Conduit and close the change

- [ ] 3.1 On pinned Conduit ask “发布文章需要填写和校验哪些字段”; verify local-condition/source-first, no BFS, no 80-node fuse, and current frontend/backend evidence.
- [ ] 3.2 Ask “文章从编辑器提交到数据库如何流转” and “这个项目有哪些主要用户流程，请逐个说明前后端细节”; verify the first reports source-verified protocol bridges plus separately bounded fact segments without claiming one directed graph path, and the second reports `inventory-unavailable` with explicit coverage/gaps and zero full-repository BFS because pinned Conduit has no Domain inventory.
- [ ] 3.3 Run focused retrieval/traversal/Chat tests followed by `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm test`; verify every command exits 0 and gold recall is not weakened by the seed cap.
- [ ] 3.4 Run `openspec validate --strict query-scope-routing` and `git diff --check`; verify both exit 0 and no test source, generated provider data, or unrelated user edit is included.
