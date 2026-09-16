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

- [ ] 4.1 将 Lazy、Full 节点局部语义选择与 MCP `semantic_plan` 接到同一 reuse planner；用相同快照/节点集合的复用、生成、不可用及差集场景测试验证分桶一致、计划只读。
- [ ] 4.2 扩展现有唯一 semantic cache writer 的锁内 node-id/file-path 核实、CAS 与 `already-fresh` 条件提交，再实现 `semantic_commit` 适配器；用跨入口并发、旧 hash、伪造 node/path、重复提交测试验证无覆盖、无丢更新、事实图 SHA 不变。
- [ ] 4.3 完成 canonical English、字段白名单与证据截断提示（完整局部源码由调用方 AI 在 Skill/prompt 中核实，不增加 server 的“已读证明”状态）；用中文模型文字、跨文件结论、source-owned literal 和证据截断正反例验证拒绝状态、可见边界与缓存字段，且 server 不生成或翻译语义。
- [ ] 4.4 验证 Lazy→MCP、MCP→Lazy、Full→MCP 的 fresh 复用，以及单文件修改后只补差集；断言全部 fresh 时零生成、零 writer 调用、cache 文件 SHA 和 provenance 逐字不变，无 MCP 专用缓存。

## 5. 宿主接入与真实验收

- [ ] 5.1 在 Claude 插件声明本地 MCP server，给 Codex 提供项目级注册步骤并更新 Skill/README 的“AI 探索→工具检索→证据核实→按需提交”编排；用宿主工具列表和实际一次调用验证两端都能发现工具，不能把仅安装 Skill 误报为 MCP 已安装。
- [ ] 5.2 用 wcp 与 cebreo 的未提交本地产物分别验收冷启动、重复/覆盖问题、源码变化、预算截断与双宿主行为；记录模型调用属于宿主而非 server、遗漏与编造分开统计，并确认项目源码/输出不进入提交。
- [ ] 5.3 运行 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、相关 lint/typecheck、插件/协议验证与 `openspec validate deterministic-mcp-boundary --strict`；记录结果，确保每个代码 PR 先合到 `feat/deterministic-mcp-boundary`，最终 feat→main PR 前复验。
