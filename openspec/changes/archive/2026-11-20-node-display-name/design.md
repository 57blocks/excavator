## 决定

### 1. 字段名 `displayName`

不用 `title`：导览步骤与产品手册的条目已经有 `title`，同名会让读者把两种东西混在一起。不用 `label`：那是界面库的词，`name` 已经是代码名。

### 2. 在写摘要的同一次读源码里写

名称与 `summary`、`tags` 由同一个模型调用、在读同一段源码时写出，不从 `summary` 改写。这样它和摘要同样以源码为依据，没有摘要的节点也能有名称，也不多花一次模型的钱。代价是每个节点多十几个输出 token。

写法规则写进 `excavator-file-analyzer` 的两种输出模式与 Chat 的按需生成提示：

- 给不懂代码的读者看：说这个节点在产品里是什么、做什么，不说实现手法；
- 函数与方法：动词短语，如 `Approve refund request`、`List offices`；
- 文件、类、配置：名词短语，如 `Refund approval list page`、`Billing service`；
- 2 到 8 个词，最多 60 个字符，句首大写，不加句号；
- 代码名本身已经是好名字时可以沿用（`approveRefund` → `Approve refund`），不为不同而不同；
- 纯技术性的节点（工具函数、配置）照实写技术名称，不编业务含义。

### 3. 确定性核对

在唯一的提交门（`commitSemanticCacheEntry`）里核对，三个入口共用：

- 是字符串，去掉首尾空白后非空；
- 最多 60 个字符、2 到 8 个词（按空白分）；
- 不含换行；
- 过英文审计：`semantic-language-audit` 的审计字段从 `summary`、`tags[i]` 扩成 `summary`、`displayName`、`tags[i]`，摘要与绑定方式不变。

不过的整条拒绝，进可见的拒绝桶并写明原因（`display-name-missing`、`display-name-shape`、语言审计原有的原因），不进缓存。整条拒绝而不是只丢名称：名称缺了的条目若留下，就成了「有摘要没名称」的第四态。

脚本核对不了名称的意思对不对，这由第 4 条的核验承担。

### 4. 核验与摘要合成一个判定

Summary-Verifier 的输入多一个 `displayName`，规则：名称或摘要任一与源码矛盾即 `contradicted`；理由写明是哪一个。消费者在 `contradicted` 时把两者一起置空，页面退回代码名。

不分开判：名称是摘要的压缩，分开判要两倍的核验调用，而两者一真一假的情形里，正确做法也是一起不信。

### 5. 缓存版本升到 `3.0.0`，旧条目整体失效

旧条目没有 `displayName`。可选的做法有两种：

- 缺字段的旧条目继续算新鲜，消费者退回代码名。这要在读、写、复用、核验四处各加一个「没有名称」的分支，而且旧条目永远不会自己补上名称（新鲜度只看源码哈希）。
- 升版本，旧条目按 `canonical-semantic-language` 已有的「非规范旧语义按需失效」处理。

选第二种。代价：已有项目升级后，下一次 Full 要为全部节点重新生成语义（花费等于一次完整的语义阶段），在这之前查看页报告语义缓存不可用、Chat 按需重生成用到的节点。事实图不受影响。

### 6. 字段清单只定义一处

`semantic-cache.mjs` 的 `CACHEABLE_FIELDS` 是唯一定义。`apply-semantic-patches.mjs` 从补丁里按它取字段（今天它手写了一份，会静默丢掉 `displayName`），`project-service.mjs` 的计划约束直接引用它，`mcp-server.mjs` 的提交 schema 按它逐项给出类型并加一个测试断言二者的键相同。

### 7. 旧的图模式增量路径

`excavator-file-analyzer` 的 GraphNode 输出模式也写 `displayName`；`lazy-analyze.mjs` 的 `SEMANTIC_NODE_FIELDS` 保留它，否则任何一次 Lazy、Full F1 或 `sync_facts` 都会把它抹掉；`validate-graph.mjs` 在它存在时按第 3 条的形状核对，缺少时记一条可见的问题，不判失败（这条路径不经过缓存的提交门）。

### 8. 查看页

`semantics.mjs` 的页面数据行从 `{id, summary, tags, verification}` 扩成加上 `displayName`，与摘要用同一条新鲜度与 `contradicted` 置空规则。explorer 副本的节点卡片：有名称时主标题是名称、副标题是代码名；没有时照旧只显示代码名。搜索键加上 `displayName`。这是对副本的一处新改动，写进 `report-viewer` 的改动清单。

## Oracle（动手前写死）

**先验装置：** 下列每条新用例先在旧代码上跑，确认为红，记进 `acceptance.md`。

1. 带合法 `displayName` 的 Full 补丁进缓存后，条目里有这个字段（旧代码：被 `apply-semantic-patches` 丢掉）。
2. 缺 `displayName`、为空、61 个字符、9 个词、含换行、非英文，各一条，分别落进对应的拒绝桶。
3. 审计字段路径为 `['summary', 'displayName', 'tags[0]', 'tags[1]']`。
4. 版本 `2.0.0` 的旧缓存判为非规范，第一次规范写入不携带旧条目。
5. 字段清单一致：`CACHEABLE_FIELDS`、MCP 计划约束、MCP 提交 schema 的键三者相同。
6. MCP `semantic_commit` 接受带 `displayName` 的提交，拒绝缺少它的提交。
7. 核验批次文件里每个候选都带 `displayName`；`contradicted` 判定后，查看页数据里该节点的 `summary` 与 `displayName` 都为空。
8. Lazy 重投影保留节点上的 `displayName`。
9. 查看页数据行的形状为 `{id, summary, tags, displayName, verification}`。

**真实运行：** go-multirepo 里 49 个文件的那个后端服务（每个 PR 的机制冒烟语料），冒烟跑一次 Full：

- 判据 1：每个新鲜条目都有 `displayName` 并通过核对；拒绝桶计数照实报告；
- 判据 2：Summary-Verifier 对名称或摘要判 `contradicted` 的比例与本变更之前同一语料的摘要矛盾率相比，增加不超过 5 个百分点（没有之前的记录时，用同一次运行里名称理由与摘要理由各自的计数代替，并写明）；
- 判据 3：按种类分层抽 30 个（文件、处理函数、其他函数各 10 个），人工读源码判名称是否说对了节点，错归属为 0；
- 判据 4：语义阶段的输出 token 比上一次同语料运行增加不超过 15%（没有上一次的记录时，先在旧代码上跑一次作基线）。

判据 2 到 4 不达标时照实记下，不挪阈值。
