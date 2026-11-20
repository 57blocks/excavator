## 1. 先验装置（先红）

- [x] 1.1 按 design 的 Oracle 第 1 到 9 条写新用例（语义缓存、语言审计、补丁应用、MCP、核验、Lazy 重投影、查看页数据），在旧代码上跑，确认全部为红，记进 `acceptance.md`
- [x] 1.2 提交：`test(semantic-cache): pin displayName oracles (red)`

## 2. 语义缓存与提交门

- [x] 2.1 `semantic-cache.mjs`：`CACHEABLE_FIELDS` 加 `displayName`，版本升到 `3.0.0`，提交门核对形状与缺失并给出两个拒绝原因
- [x] 2.2 `semantic-language-audit.mjs`：审计字段加 `displayName`
- [x] 2.3 `apply-semantic-patches.mjs`：按 `CACHEABLE_FIELDS` 取字段，不再手写清单
- [x] 2.4 更新钉死旧字段清单、旧审计路径与版本 `2.0.0` 的既有测试与夹具
- [x] 2.5 提交：`feat(semantic-cache): carry a checked displayName on every entry`

## 3. MCP

- [x] 3.1 `project-service.mjs` 的计划约束引用 `CACHEABLE_FIELDS`；`mcp-server.mjs` 的提交 schema 加 `displayName`，加三处键一致的测试；`docs/mcp.md` 写明新字段
- [x] 3.2 提交：`feat(mcp): accept displayName in semantic_commit`

## 4. 核验

- [x] 4.1 `apply-verification.mjs`：候选带 `displayName`；`agents/excavator-summary-verifier.md`：一个判定覆盖两段文字，理由写明是哪一段
- [x] 4.2 提交：`feat(verification): check displayName with its summary`

## 5. 提示词

- [x] 5.1 `agents/excavator-file-analyzer.md`：两种输出模式写 `displayName`，写法规则照 design 第 2 条；存储语言一节加上 `displayName`
- [x] 5.2 `skills/excavator/SKILL.md`：F2 派发的补丁形状、F2 提交脚本、Phase 2 的 GraphNode 字段；`skills/excavator-chat/SKILL.md`：按需生成的提示与提交字段
- [x] 5.3 更新钉死提示词原文的测试（`test_prompt_evidence_sections`、`storage-language-control`）
- [x] 5.4 提交：`feat(excavator): have analyzers write displayName`

## 6. 图模式路径

- [x] 6.1 `lazy-analyze.mjs` 的 `SEMANTIC_NODE_FIELDS` 加 `displayName`；`validate-graph.mjs` 在它存在时核对形状、缺少时记可见问题
- [x] 6.2 提交：`feat(graph): keep and check displayName on graph nodes`

## 7. 查看页

- [x] 7.1 `skills/excavator-view/semantics.mjs`、`explorer-data.mjs`：页面数据带 `displayName`，`contradicted` 时与摘要一起置空
- [x] 7.2 `packages/explorer`：节点卡片主标题与副标题、搜索键；重新构建内置的 explorer 包
- [x] 7.3 提交：`feat(view): show displayName on node cards`

## 8. 验收

- [x] 8.1 变异：去掉形状核对、审计不含 `displayName`、补丁应用回到手写清单、版本不升、核验候选不带名称、`contradicted` 不置空名称、Lazy 重投影丢名称，逐个确认至少一个用例变红
- [x] 8.2 真实运行：按 design 的判据 1 到 4 跑 49 个文件的冒烟语料，记录花费与结果
- [x] 8.3 记进 `acceptance.md`（只写机制与规模，不写语料名）

## 9. 门与合并

- [x] 9.1 本地只跑受影响范围（`git grep -l` 找读这些模块的测试，一条 vitest 命令）+ `pnpm --filter @excavator/core test` 若动到 core + `openspec validate --all --strict`；全量交 CI gate
- [x] 9.2 PR 用 `--merge` 指向 `main`，评审按 `REVIEW.md`
