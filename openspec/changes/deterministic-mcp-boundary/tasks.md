## 1. 验收 oracle 与边界夹具

- [x] 1.1 先写定 seven-tool contract、无模型调用、同一快照/预算/错误桶、跨入口 cache SHA/provenance 的验收矩阵；用一个已知错误的伪工具响应或错误配置证明检查会失败，再记录可复现的 red 结果。
- [x] 1.2 建立临时小仓库夹具，包含同内容异路径、同名异 owner、symlink 越界、`.excavator/` 越界 symlink、missing/stale/noncanonical/fresh cache；用夹具测试先看到预期拒绝/分桶，不提交真实项目源码或生成物。

## 2. 共享确定性服务和安全边界

- [x] 2.1 将当前状态读取、Lazy 事实同步、检索/遍历与证据读取抽为 CLI 和 MCP 共用的可调用服务；用既有 CLI 回归测试和同快照等价测试证明没有第二套评分、遍历或事实构建逻辑。
- [x] 2.2 实现单项目根目录绑定、规范相对路径、realpath containment 与 `.excavator/` 写入边界；用 `..`、绝对路径、外部 symlink、数据目录 symlink 和合法工作树夹具验证拒绝/允许结果。
- [x] 2.3 实现统一 snapshot-bound 响应、输入/输出预算、显式 truncated/boundary/gaps 和 stale-snapshot 终态；用预算命中、调用期间源码变化、缺失索引及未知节点测试验证每个输入进入可见桶。

## 3. MCP 协议与只读/事实工具

- [x] 3.1 增加锁定版本的官方 MCP server SDK、stdio 入口和输入/输出 schema，只在 stderr 输出诊断；通过真实 MCP client 握手与 tools/list 测试验证恰好发现七个工具，且无 API key 时 server 可运行。
- [x] 3.2 实现 `project_status` 和 `sync_facts`，只调用既有确定性同步且不触发 Full 模型阶段；用干净/过期/缺失数据夹具与当前源码 SHA、事实 coverage 比较，并验证源码字节不变、失败可见。
- [x] 3.3 实现 `recall` 与 `traverse` 的明确 terms/seeds、有界响应及继续边界；用同输入 CLI/MCP 等价、80 节点预算命中与大范围分轮探索测试验证不伪称完整。
- [x] 3.4 实现 `read_evidence` 的当前源码/事实范围读取和行号定位；用合法范围、过大范围、源码漂移和外部路径测试验证证据不越界且旧证据不会标为 fresh。

## 4. 单一语义缓存闭环

- [x] 4.1 将 Lazy、Full 节点局部语义选择与 MCP `semantic_plan` 接到同一 reuse planner；用相同快照/节点集合的复用、生成、不可用及差集场景测试验证分桶一致、计划只读。
- [x] 4.2 扩展现有唯一 semantic cache writer 的锁内 node-id/file-path 核实、CAS 与 `already-fresh` 条件提交，再实现 `semantic_commit` 适配器；用跨入口并发、旧 hash、伪造 node/path、重复提交测试验证无覆盖、无丢更新、事实图 SHA 不变。
- [x] 4.3 完成 canonical English、字段白名单与证据截断提示（完整局部源码由调用方 AI 在 Skill/prompt 中核实，不增加 server 的“已读证明”状态）；用中文模型文字、跨文件结论、source-owned literal 和证据截断正反例验证拒绝状态、可见边界与缓存字段，且 server 不生成或翻译语义。
- [x] 4.4 验证 Lazy→MCP、MCP→Lazy、Full→MCP 的 fresh 复用，以及单文件修改后只补差集；断言全部 fresh 时零生成、零 writer 调用、cache 文件 SHA 和 provenance 逐字不变，无 MCP 专用缓存。

## 5. 宿主接入与真实验收

- [x] 5.1 在 Claude 插件声明本地 MCP server，给 Codex 提供项目级注册步骤并更新 Skill/README 的“AI 探索→工具检索→证据核实→按需提交”编排；用宿主工具列表和实际一次调用验证两端都能发现工具，不能把仅安装 Skill 误报为 MCP 已安装。
- [ ] 5.2 用 wcp 与 cebreo 的未提交本地产物分别验收冷启动、重复/覆盖问题、源码变化、预算截断与双宿主行为；记录模型调用属于宿主而非 server、遗漏与编造分开统计，并确认项目源码/输出不进入提交。（部分完成，见「验收记录」；wcp 因共享快照性能悬崖在默认宿主超时下不可用、且当前 stale，待 `snapshot-resolve-performance` 合入后重跑；cebreo 无 built 数据且被其他 agent 占用，本轮未 live。保持未勾。）
- [ ] 5.3 运行 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、相关 lint/typecheck、插件/协议验证与 `openspec validate deterministic-mcp-boundary --strict`；记录结果，确保每个代码 PR 先合到 `feat/deterministic-mcp-boundary`，最终 feat→main PR 前复验。（本 PR 结果见「验收记录」；`feat→main` 前复验与合并保持开放。）

## 验收记录（B′，Opus 执行，Fable 裁定）

**代码收口**：在既有 3 个实现提交（tasks 1–4 + 5.1 声明）之上，新增 `fix(mcp): never resolve the source snapshot on the tool error path`（错误路径不再解析快照——大仓上被拒请求本不该和真实调用一样贵）。

**5.3 门（本 PR，全绿）**：`pnpm -r build` ✅；`pnpm test` 72 files / 1274 passed | 4 skipped ✅；`pnpm typecheck` ✅；`claude plugin validate` ✅；`openspec validate deterministic-mcp-boundary --strict` ✅。仓库级 `eslint` 无 `eslint.config.*`（main 亦然，非本 change 引入，且不在 AGENTS 三件套内）。`feat→main` 前复验与合并未做（开放）。

**5.1 宿主发现**：`.mcp.json`（Claude 插件声明，`${CLAUDE_PLUGIN_ROOT}` + `${CLAUDE_PROJECT_DIR}`）+ `docs/mcp.md`（Claude/Codex 注册、真实耗时与超时）+ README/chat SKILL 指向，并明确「仅装 Skill ≠ 装 MCP」。真实 MCP client（`@modelcontextprotocol/client`）经 stdio 对真实 server 二进制在 wcp 与 go-clean-arch 上 `tools/list` 均恰好发现 7 个工具、无 API key 可运行。Claude/Codex 图形宿主内 `/mcp` live 发现本轮未单独跑（配置已验、协议级已验）。

**5.2 真实语料验收**：
- **wcp**（accepted，非 git 根 + 5 member git 仓、约 2000 文件）：真实 MCP client 发现 7 工具 ✅；但每个读工具调用 `open`+`finish` 两次全量解析源码快照 ≈150–230s，超过 SDK 默认 60s 请求超时 → 实测 REQUEST_TIMEOUT（`connect`/`callTool` 传 `timeout` 未能覆盖该默认）。且 wcp 事实当前 **stale**（`selectionDigest` 从 `bff2ab…` 漂到 `1363fe…`，因 main 09-16 的 safe source selection 策略变更，wcp 数据为 09-15 建）。结论：**功能正确但默认宿主超时下不可用**；根因为共享 `source-snapshot` 逐文件 `git show`（同样拖慢 Lazy/Full 与 freshness hook），归 `snapshot-resolve-performance`。
- **go-clean-arch**（小 git 仓，本轮临时以当前代码重建后 fresh、验收后已还原原状）：经真实 MCP client 跑通全部 fresh-path——`project_status` ok/fresh（含完整 coverage 分桶、`selection` policy v1、sensitive=0）、`read_evidence` 返回真实 Go 源、`recall` 截断可见（total/used/nextOffset）、`traverse` node-budget 边界含真实未展开邻居、`read_evidence ../secret.ts`→containment（`snapshot:null`，即上面错误路径修正）、超大范围→invalid-request、`expectedRevision` 伪值→stale-snapshot。宿主 AI（本 Opus）读真实源码后亲写英文 node-local 摘要经单一锁内 CAS writer：`semantic_commit` ok/committed（languageAudit 3 字段全英文、rejected=[]）→ `semantic_plan` reuse:1/generate:0 逐字复用（**零再生成**）→ 重复提交 already-fresh（不重写）→ 错 hash stale-hash（CAS 拒绝）。**编造 vs 遗漏**：摘要每条主张均落在其 6 行源码内，编造 0、无实质遗漏；模型工作属宿主，server 零生成/零翻译。
- **cebreo**（accepted）：为 DirectorySnapshot（非 git、无 member），`resolveSourceSnapshot` 实测 0.57s、不受 git 悬崖影响；但无 built `.excavator` 数据且被其他 agent 占用，本轮未 live，不向其写数据。待其数据建好后补跑。
- **不进提交**：wcp/go-clean-arch 的源码与 `.excavator` 产物均未提交；探针脚本 `_mcp_probe_*.mjs` 用完删除、不入库。

**遗留（follow-up change `snapshot-resolve-performance`，从 main 切）**：去掉 `git-utils.mjs` 逐文件 Node helper（改 `spawnSync('git',…)` / `git cat-file --batch`）、`GitCommitSnapshot.search` 改 `git grep … <sha>`；先冻新旧实现在 selection-safety 夹具 + >8KB 私钥头文件 + 恰 4096/4097 字节文件上的 `revision/selectionDigest/selection/listFiles/entries` 逐字相等，`tests/{snapshot,selection-safety,revision-sync}` 零改动全绿，wcp 解析 ≤10s 且 `project_status` 在默认 60s 内返回。合 main 后 main→feat 复跑本 change 的 5.2。
