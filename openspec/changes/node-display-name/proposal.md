## Why

查看页上的节点只能显示代码名：`OrderList`、`rejectRequest`、`GET /v2/orders/:id`。读图的人要先懂代码才知道每个节点是什么。知识图里每个节点有模型写的英文 `summary`，但它是一两句话，放不进图里的节点框；产物里没有任何「短名称」。

在 go-multirepo 上做的原型里，我们让一个子代理在事后读 `summary`、函数名与路径，给查看页用到的几百个节点写短名称。名称读起来可用，但这条路有两个问题：

- 它是对已有摘要的再加工，不是读源码写出来的。没有摘要的处理函数（约占一成），名称只能从网址路径猜。
- 它在分析之外又花一次模型的钱，而且每个消费者都要各做一次。

名称应当和摘要在同一次读源码时写出、存进同一个语义缓存、经同一套核对。这样 `/excavator` 完整分析一次，所有消费者都能用。

## What Changes

- **语义缓存条目多一个字段 `displayName`：** 一个给非技术读者看的英文短名称，说明这个节点是什么或做什么。函数写成动词短语（`Approve refund request`），文件与类写成名词短语（`Refund approval list page`）。它与 `summary`、`tags` 在同一次读源码时写出。
- **每次新写入都必须带 `displayName`：** Full F2 的语义补丁、Chat 按需生成、MCP `semantic_commit`，以及旧的图模式增量路径写出的节点。
- **确定性核对：**
  - 非空，最多 60 个字符、2 到 8 个词；
  - 过英文审计（与 `summary`、`tags` 同一套）；
  - 不过的条目整条落进可见的拒绝桶，不进缓存。
- **核验：** Summary-Verifier 同时拿到 `summary` 与 `displayName`，给一个判定。`contradicted` 时两者在消费者那里一起置空。
- **缓存版本升到 `3.0.0`：** 旧条目没有 `displayName`，按「非规范旧语义」整体失效、按需重新生成。不保留缺字段的兼容分支。
- **可缓存字段只写一处：** 现在字段清单散在四处（缓存模块、补丁应用、MCP 计划、MCP 提交的 schema）。改成一处定义，其余从它派生，并加一个测试钉住。
- **消费者：**
  - `/excavator-view` 的页面数据带上 `displayName`，节点卡片以它为主标题，代码名作副标题；
  - MCP `recall` 与 Chat 检索的文本包含 `displayName`。

**不做：**

- 不存第二种语言。`displayName` 与 `summary` 一样只存英文（见 `canonical-semantic-language`）；查看页不翻译它。
- 不为前后端接口、页面单独建名称。接口用处理函数的 `displayName`，页面用页面文件的 `displayName`，由以后的查看页变更取用。
- 领域图、设计图、文档图的节点已有各自的名称，不在本变更内。
- 导览、手册、explain、onboard、diff 暂不改，以后按需取用。

## Capabilities

### Modified Capabilities

- `semantic-cache`：可缓存字段加入 `displayName`；新增「节点显示名」要求（形状、核对、版本）。
- `canonical-semantic-language`：英文规则覆盖 `displayName`。
- `graph-validation`：摘要核验同时核对 `displayName`。
- `report-viewer`：离线仪表盘的节点卡片显示 `displayName`。

## Impact

- 语义缓存：`skills/excavator/semantic-cache.mjs`、`semantic-language-audit.mjs`、`apply-semantic-patches.mjs`、`apply-verification.mjs`、`lazy-analyze.mjs`、`validate-graph.mjs`。
- MCP：`skills/excavator/mcp-server.mjs`、`project-service.mjs`、`docs/mcp.md`。
- 提示词：`agents/excavator-file-analyzer.md`（GraphNode 模式与语义补丁模式）、`agents/excavator-summary-verifier.md`、`skills/excavator/SKILL.md`（F2 派发、F4 核验、Phase 2）、`skills/excavator-chat/SKILL.md`（按需生成）。
- 查看页：`skills/excavator-view/semantics.mjs`、`explorer-data.mjs`、`packages/explorer` 的节点卡片与搜索键，重新构建内置的 explorer 包。
- 测试：钉死字段清单、审计字段路径、缓存版本 `2.0.0`、补丁形状、查看页数据形状与提示词原文的测试都要更新。
- 已有项目的语义缓存在升级后整体失效：下一次 Full 重新生成全部语义，Chat 按需重新生成用到的节点。
