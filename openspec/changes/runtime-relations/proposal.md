## Why

Excavator 说不出一个项目的运行单元之间怎么通信。在一个多仓项目（go-multirepo：React 前端、Go 与 Node 后端、一个 OAuth2 认证服务、对 SaaS 的出站调用）上实测：

- 知识图有 40,183 条边，全部落在单个子项目内部；
- 域图的 437 条流程里，跨前端与后端的是 0 条。

前端的 `client.get(`${base}/v2/leaves/${id}`)` 与后端的 `group.GET("/:leave_id", h)` 之间、发布者与订阅者之间、socket 的 `emit` 与 `on` 之间，图里都没有关系。

用户比较了两条路：Core 里的确定性抽取器与模型驱动的 skill，选了 skill。理由：通信写法的长尾（各框架挂前缀的方式、包装过的客户端、消息中间件、实时事件）需要一份份适配，模型一份提示词就能覆盖；而模型的代价——编造、两次运行不同、漏列不报错——可以由与框架无关的脚本兜住：逐条核引文、每个输入落可见桶、守恒、两次运行的一致性测量。确定性抽取只在测量表明模型对某一类关系不行时再加。

已有的 `http-links` 提案（未实现）只覆盖前端到后端的 HTTP。本变更覆盖它的范围，并扩到服务间调用、异步消息、实时事件与外部系统；两者的关系见 design 的 D11。

## What Changes

- **新 skill `/excavator-relations`**：找出项目的运行单元之间怎么通信，写出 `.excavator/relations-graph.json` 与覆盖报告 `.excavator/reports/relations-coverage.json`。
- **第一版范围**（五类，按机制分）：
  - `http`：前端到后端、服务到服务的 HTTP 调用（含包装过的客户端、Feign 这类声明式客户端）；
  - `rpc`：gRPC 这类按服务名与方法名寻址的调用；
  - `message`：队列、主题、Redis 发布订阅，以及跨单元的进程内事件总线；
  - `realtime`：WebSocket 与 socket.io 的 `emit`/`on`；
  - `external`：对外部系统（SaaS API、邮件、存储）的出站调用，记为指向一个具名外部端点的关系。
  共享数据库表、共享缓存与文件、认证信任、定时触发、部署与配置接线等后续种类，分析器注意到时只计数（`out-of-scope`），不连。
- **流水线**（脚本准备与分区、子代理写关系、脚本核对与合并）：
  1. **单元，一次决定并存储**：脚本按清单文件（`package.json`、`go.mod`、`pom.xml`/`build.gradle`、`pyproject.toml` 等、`*.csproj`）与入口证据列出运行单元；知识图里有 F1 路由入口点时，它们也作为服务端证据。单元清单按输入摘要存进 `.excavator/relations-units.json`，热运行复用。
  2. **分区**：脚本按单元列出候选文件（引入 HTTP、RPC、消息或 socket 客户端的文件，注册路由或订阅的文件，引入了这些客户端包装文件的文件），按行数上限装区；配置与环境文件里的地址行作为证据随区下发。
  3. **每区一个分析子代理**：每条关系写出种类、调用端与接收端（文件、行、知识图节点 id、逐字引文）、规范化地址（方法加路径、主题、事件名或外部主机）与置信理由。找不到的一端写成单边，不猜。
  4. **合并脚本**：逐条核引文与节点 id；按规范化地址跨区配对；每个端点与每个候选文件落一个可见桶；守恒检查，没有候选会消失。
  5. **报告与终端查询**：沿用域 skill 的输出与新鲜度模式。`/excavator-view` 的接入另起变更。
- **升级信号**：覆盖报告按关系种类记三个数——引文失败率、未解析占比、同一输入两次运行的一致性（已配对地址对的 Jaccard）。低于事先写定阈值的种类列为确定性抽取的候选，本变更不建抽取器。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose runtime-relations`
2. `feat(excavator-relations): decide runtime units once and split call-site areas`
3. `feat(excavator-relations): check, pair and bucket the analyzers' relations`
4. `feat(excavator-relations): skill prompt and relations analyzer`
5. `docs(openspec): record the measured relations of runtime-relations`

## Capabilities

### New Capabilities

- `runtime-relations`：模型写出运行单元之间的通信关系，脚本决定单元、分区、核对引文与节点 id、按地址配对、分桶守恒，并按种类测量引文失败率、未解析占比与两次运行的一致性。

### Modified Capabilities

无。

## Impact

- 新增 `skills/excavator-relations/`：`SKILL.md`、`plan-units.mjs`、`split-relation-areas.mjs`、`merge-relations.mjs`、`relations-address.mjs`、`relations-signals.mjs`、`relations-freshness.mjs`。
- 新增子代理定义 `agents/excavator-relations-analyzer.md`。
- 新增测试 `tests/relations/`：单元、分区、地址规范化与配对、每个桶与引文拒收的夹具、守恒、一致性测量、skill 契约。
- `tests/install/install.test.mjs` 的 skill 数加一；`README.md` 加一行用法。
- 不改 `packages/core/`，不改知识图格式，不改其它 skill 的产物。
