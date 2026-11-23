## ADDED Requirements

### Requirement: 运行单元一次决定并复用

`/excavator-relations` SHALL 由 `plan-units.mjs` 按清单文件与入口证据决定运行单元（`runtime`、`library`、`container`，不在任何清单下的文件归 `unmanifested` 合成单元），每个单元带入口证据（文件、行、原文、规则），知识图里有 `http` 路由入口点时 SHALL 把它们作为入口证据。单元清单 SHALL 写到 `.excavator/relations-units.json`，带输入摘要；摘要不变时 SHALL 原样复用并打印 `units=reused`，只有 `--reunit` 或输入变化才重新决定。

#### Scenario: 热运行复用单元
- **WHEN** 同一副本第二次运行，清单与入口证据都没变
- **THEN** 打印 `units=reused`，`relations-units.json` 逐字节不变

#### Scenario: 没有入口的清单
- **WHEN** 一个 `package.json` 没有 `bin`，也没有以 `start`、`dev`、`serve`、`preview` 开头的脚本，单元内也没有源码级入口证据与路由入口点
- **THEN** 该单元的 `kind` 为 `library`，它的候选文件照样分区

### Requirement: 候选文件分区

`split-relation-areas.mjs` SHALL 对每个单元的非测试源码文件逐行跑信号表，命中的文件、引入了客户端定义文件的文件、知识图里有路由入口点的文件为候选；SHALL 在单元内按路径排序、按行数上限装区，区不跨单元，单个超限文件独占一区并标 `overBudget`；每个区上下文 SHALL 带本次令牌、本单元的地址类配置行与全部单元的摘要，键名像密钥的配置行 MUST NOT 进上下文。每次运行 SHALL 先删除上一次的区目录。

#### Scenario: 经包装客户端调用的文件
- **WHEN** `api.ts` 创建 axios 实例，`users.ts` 只引入 `api.ts` 并调用 `api.get('/users')`
- **THEN** 两个文件都是候选

#### Scenario: 密钥行
- **WHEN** `.env` 里有 `API_URL=http://svc:8080` 与 `API_TOKEN=abc`
- **THEN** 区上下文的配置行有前者，没有后者

### Requirement: 端点核对

合并 SHALL 逐个端点核对：路径在项目根内、端点文件是本区文件、行号在范围内、引文是所引行起 3 行的子串、每条证据引文同样成立、地址的字面部分出现在端点行或证据行起 4 行内（同一文件同一行有路由入口点且路径相同时按入口点核过）。任一条不过 SHALL 把端点放进 `quote-failed` 并写原因，MUST NOT 参与配对。节点 id 不在知识图或不在端点文件上的 SHALL 被替换为脚本推导的节点并计数。

#### Scenario: 编造的路径段
- **WHEN** 调用端引文是真实的 `api.get('/users')` 行，地址写成 `GET /accounts`
- **THEN** 端点进 `quote-failed`，原因 `address-not-quoted`

#### Scenario: 越出项目根
- **WHEN** 端点文件是 `../other/x.ts`
- **THEN** 不读该文件，端点进 `quote-failed`，原因 `outside-root`

#### Scenario: 节点 id 错
- **WHEN** 端点的 `nodeId` 不在知识图里
- **THEN** 端点保留，`nodeId` 换成同文件包含该行的节点，`nodeIdRejected` 加一

### Requirement: 按地址配对与分桶守恒

合并 SHALL 规范化地址并只在不同的侧（单元加语言族）之间配对：`http` 按段逐一匹配、字面段多者胜，唯一为 `linked`、多个为 `ambiguous`；`message`、`realtime` 同键的每个接收端都 `linked`；`external` 核过即 `linked` 到具名外部端点。每个端点 SHALL 恰好落一个桶（调用端：`linked`、`ambiguous`、`caller-only`、`address-unresolved`、`quote-failed`；接收端：`linked`、`receiver-only`、`address-unresolved`、`quote-failed`），后续种类计入 `out-of-scope`；每个候选文件 SHALL 恰好落 `cited`、`declared-skip`、`ends-rejected`、`silent-zero` 之一。端点守恒不成立时 SHALL 退出 4 且不写 `relations-graph.json`；有区缺失或被拒时 SHALL 退出 3。

#### Scenario: 参数路径配字面路由
- **WHEN** 调用端 `GET /users/{}`，两个单元分别注册 `GET /users/:id` 与 `GET /users/me`
- **THEN** 字面段数相同，调用端进 `ambiguous` 并列出两个候选

#### Scenario: 同侧不配
- **WHEN** 调用端与唯一能配上的接收端在同一单元、同一语言族
- **THEN** 调用端进 `caller-only`，接收端进 `receiver-only`

#### Scenario: 同单元的浏览器代码配服务端
- **WHEN** 一个单元里 TypeScript 文件调用 `GET /api/items`，同单元的 Java 文件注册了它
- **THEN** 两者是不同的侧，调用端 `linked` 到该接收端

#### Scenario: 候选文件没有结果
- **WHEN** 一个候选文件既没有端点引到它，也不在 `skippedFiles` 里
- **THEN** 它进 `silent-zero` 并被打印

#### Scenario: 候选文件的端点全被拒
- **WHEN** 分析器在一个候选文件里写了端点，核对把它们全部拒掉，也没有别的端点或证据引到它
- **THEN** 它进 `ends-rejected`，不算 `silent-zero`

### Requirement: 一致性测量与升级信号

合并 SHALL 在输入摘要与上一次产物相同时，按种类计算两次 `linked` 键集合的 Jaccard 并写进覆盖报告；SHALL 按种类记引文失败率与未解析占比；一致性低于 0.80（并集至少 5 条时）、引文失败率高于 10% 或未解析占比高于 30% 的种类 SHALL 列为确定性抽取的候选并写明原因。

#### Scenario: 同一输入的第二次运行
- **WHEN** 同一副本连跑两次
- **THEN** 第二次的覆盖报告里每个有配对的种类都有 Jaccard 与两次的条数

#### Scenario: 输入变了
- **WHEN** 两次运行之间改了一个候选文件
- **THEN** 一致性为 `null`，原因写明输入不同
