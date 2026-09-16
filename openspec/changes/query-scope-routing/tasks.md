## 1. Remove the over-designed policy layer

- [x] 1.1 Acceptor revises `acceptance-oracle.md` so the three exact Conduit questions score observable AI routing, top-20 recall, top-5 traversal, graph boundaries, evidence coverage, and unsupported path/completeness claims without requiring a query-plan/executor API; verify no production function or schema is prescribed.
- [x] 1.2 Coder removes `skills/excavator/query-scope-routing.mjs` and the fake query-plan/executor red fixtures introduced by this change; verify no runtime validator/executor/scorer export or reference remains and existing retrieval behavior is still covered by focused tests.

## 2. Route with the Skill and keep only mechanical fuses in code

- [x] 2.1 Coder updates `skills/excavator-chat/SKILL.md` with the ordered AI intent contract and removes calls to query-plan/selection validators; verify the frozen publish-field question selects local/source-first, the editor-to-database question selects bounded segmented flow, an explicit A→B question selects shortest path, and direct-caller questions select 1-hop without a keyword classifier.
- [x] 2.2 Coder separates top-20 candidate recall from top-5 graph expansion in the Skill and changes only `DEFAULT_TRAVERSAL_BUDGETS.maxSeeds` from 20 to 5; verify BM25 still returns up to 20 candidates, the selected seed list is capped at 5, and a sixth supplied seed produces a visible `seed-budget` boundary.
- [x] 2.3 Coder adds inventory/Domain routing and honest boundary reporting to the Skill; verify all-process requests never start one full-repository BFS, missing inventory returns `inventory-unavailable` plus coverage/gaps, and any traversal reports its actual reason/truncated/budgets and uncovered scope without claiming completeness.
- [x] 2.4 Coder adds the segmented flow and evidence gates to the Skill; verify HTTP/API or other fact-graph breaks become explicit source-verified bridges between separately bounded fact segments, no continuous/directed graph path is fabricated, stale navigation candidates enter visible gaps, and frontend UI validation is distinguished from backend enforcement.
- [x] 2.5 Acceptor independently reviews the implementation against `query-scope-routing/spec.md`; verify semantic routing remains in Skill/prompt, deterministic code is limited to retrieval mechanics and hard fuses, existing undirected fact-edge semantics remain intact, and no adaptive-memory persistence, protocol-edge synthesis, directional graph rewrite, or policy validator was bundled.

## 3. Validate on Conduit and close the change

- [x] 3.1 On pinned Conduit ask “发布文章需要填写和校验哪些字段”; verify local/source-first, no BFS, no 80-node fuse, and current frontend/backend evidence.
- [x] 3.2 Ask “文章从编辑器提交到数据库如何流转” and “这个项目有哪些主要用户流程，请逐个说明前后端细节”; verify the first reports source-verified protocol bridges plus separately bounded fact segments without claiming one directed graph path, and the second reports `inventory-unavailable` with explicit coverage/gaps and zero full-repository BFS because pinned Conduit has no Domain inventory.
- [x] 3.3 Run focused retrieval/traversal/Chat tests followed by `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm test`; verify every command exits 0 and gold recall is not weakened by the seed cap.
- [x] 3.4 Run `openspec validate --strict query-scope-routing` and `git diff --check`; verify both exit 0 and no test-project source, generated provider data, or unrelated user edit is included.
