## Context

- `/excavator-domain` 的形状已经验证过：脚本列候选、分区（`split-domain-areas.mjs`），需要跨运行稳定的判断只做一次并按摘要存储（`plan-domains.mjs`），每区一个子代理写模型产物，合并脚本按固定规则核对、合并、分桶、守恒（`merge-domain-areas.mjs`），区上下文带本次令牌，旧文件冒充不了本次输出。本变更照这个形状做。
- F1 路由入口点（`route-entry-points`，PR 进行中）在知识图里是 `{"record":"entryPoint"}` 记录流：`routeKind`、`method`、拼好前缀的 `path`、`file`、`line`、`bucket`。本变更在它存在时把它当服务端证据，不存在时照常运行；读知识图时逐行读，不依赖存储模块认识这个记录流。
- `http-links` 提案（未实现）用模型列接口与请求、脚本核对配对，只覆盖 HTTP。它的路径统一写法与「字面胜参数」配对规则在本变更里沿用（D6）。

## Goals / Non-Goals

**Goals**
- 一份提示词覆盖所有框架、语言与五类机制；脚本里没有框架分支。候选信号是一张数据表（D3），只决定「给模型看哪些文件」，不决定关系。
- 编造是硬指标：每个端点都能被脚本对回所引的行，地址里的字面部分要出现在所引的行或证据行里；对不回的进 `quote-failed`，不参与配对。
- 每个端点、每个候选文件落一个可见桶，守恒检查失败时不写产物。
- 单元清单跨运行稳定；同一输入的两次运行，配对结果的一致性被测量并写进报告。

**Non-Goals**
- 不改 Core，不往知识图写边。关系是模型写、脚本核过的推断产物，与 doc-map 同类，不进事实层。
- 不建确定性抽取器；只给出「哪类需要」的测量信号。
- 不连后续种类（共享表、共享缓存与文件、认证信任、定时触发、部署与配置接线），只计数。
- 不判断调用在运行时是否真的发生（死代码、开关后面的调用）。
- 不接 `/excavator-view`（另起变更）。
- 不指定模型。

## Decisions

### D1 单元由脚本按规则决定，按输入摘要存储复用

`plan-units.mjs` 遍历项目（跳过依赖、构建产物与点目录），找清单文件：`package.json`、`go.mod`、`pom.xml`、`build.gradle`/`build.gradle.kts`、`pyproject.toml`/`setup.py`/`requirements.txt`、`*.csproj`。每个清单所在目录是一个单元候选，按固定规则定 `kind`：

- 源码级入口证据——Go 模块里有 `package main`；JVM 源码里有 `static void main` 或 `@SpringBootApplication`；Python 有 `__main__` 守卫、`FastAPI()`/`Flask()` 或 `manage.py`；`.cs` 里有 `Main` 或 `WebApplication.CreateBuilder`、或与 `.csproj` 同在的 `Program.cs`；或者知识图里有落在该单元的 `http` 路由入口点——先判，有则 `runtime`，即使它的清单也声明了子模块（一个构建里带库模块的应用）；
- 否则声明了子模块的清单（`workspaces`、`<modules>`、同目录的 `pnpm-workspace.yaml`/`lerna.json` 或 `settings.gradle` 的 `include`）为 `container`；
- 否则清单级入口证据——`package.json` 的 `bin` 或以 `start`/`dev`/`serve`/`preview` 开头的脚本、`.csproj` 的 `OutputType` 为 `Exe` 或 Web SDK、`[project.scripts]`——为 `runtime`；
- `library`：其余清单；
- 不在任何清单下的文件归一个合成单元 `unit:.`，`kind` 为 `unmanifested`。

文件归最深的那个清单目录。入口证据逐条记下（文件、行、原文、规则）。

**存储与复用：** 单元清单写到 `.excavator/relations-units.json`（格式 `excavator-relations-units/1`），带输入摘要：规则版本、每个清单的路径与内容哈希、每条入口证据、路由入口点的单元计数。摘要相同则 `units=reused`，原样复用；不同则重新决定并写明哪些单元新增、消失或改了 `kind`。`--reunit` 强制重做。

**为什么不派模型决定单元：** 清单与入口是结构化事实，规则能读准；模型产物要靠存储才稳定，而规则天然稳定、零花费。判断错一个单元的代价有限：配对按地址进行，单元只用于「排除同侧配对」（D6）与报告分组。代价是规则读不懂的入口写法会把运行单元判成 `library`，这时它的文件照样分区、照样分析，只是单元 `kind` 不准；单元清单在报告里逐条列出证据，看得见。

### D2 分区：按单元、按行数上限

`split-relation-areas.mjs` 对每个单元的源码文件（跳过测试文件，含 `src/gatling/` 下的压测脚本）逐行跑 D3 的信号表。有命中的是候选文件；另外，引入了「客户端定义文件」（有客户端引入信号的文件，例如创建 axios 实例的文件）的文件也是候选，引入关系取知识图的 `imports` 边，再加上 JS 族文件自己的 `import`/`require`：相对路径，以及 `@/`、`~/`（约定指向本单元的 `src/`）。知识图里有路由入口点的文件也是候选。`container` 单元自己的候选（子项目之外的构建与工具脚本）计为 `container-skipped`，不进区。

候选文件按路径排序，在单元内装区，每区行数不超过 `--max-lines`（默认 4000）；单个超限的文件独占一区并标 `overBudget`，不切。区不跨单元。

每个区上下文（格式 `excavator-relations-area/1`）带：本次令牌、输出路径、本单元信息、全部单元的摘要（id、名字、根目录、`kind`、至多 20 行地址类配置）、本区文件（行数、信号命中行、该文件的知识图函数与类节点 `[id, 起行, 止行]`、该文件的路由入口点）、本单元的地址类配置行与项目根的部署配置行（D4）。每次运行先删掉旧的 `intermediate/relations-areas/`。

### D3 信号表是数据

`relations-signals.mjs` 导出一张表，每项是 `{id, family, pattern}`，`family` 为 `client`（HTTP 客户端）、`server`（路由注册）、`call`（带路径参数的调用形状）、`rpc`、`message`、`realtime`、`external`；除 `server` 与 `call` 外都算「客户端定义」，引入它们的文件也进区。模式只匹配一行文本：库的引入（`axios`、`@angular/common/http`、`socket.io-client`、`kafkajs`、`amqplib`、`google.golang.org/grpc`……）、注解与装饰器（`@GetMapping`、`@SubscribeMessage`、`@KafkaListener`……）、与框架无关的调用形状（`.get(` 后跟以 `/` 或 `${` 开头的字符串）。表只决定哪些文件进区、命中行作为提示给模型；关系由模型写，由 D5 核对。表漏掉的写法会让文件不进区，这类漏项在报告里看不见——由验收的抽查与留出语料估计，不靠表的完整性。

### D4 地址证据随区下发

模型要把调用端的地址写成服务端看到的完整路径，常常要读基地址。脚本从配置类文件（`.env*`、`*.yml`、`*.yaml`、`*.properties`、`*.toml`、`*.conf`、`environment*.ts`、`*config*.{js,ts,mjs,cjs}`、`docker-compose*`、`Dockerfile`、`proxy.conf*`）里取含 URL、主机、端口、主题、队列类键名的行，每个文件至多 25 行（免得一份大的部署清单占满整个单元的份额），每单元至多 200 行；键名像密钥（`SECRET`、`PASSWORD`、`TOKEN`、`KEY`、`CREDENTIAL`、`PRIVATE`）的行不取。项目根与不属于任何运行单元的部署文件（`docker-compose*`、网关与代理配置）作为项目级配置，至多 200 行。

### D5 每个端点都能被对回所引的行

分析器写的每条关系有调用端 `caller` 与接收端 `receiver`，任一端可为 `null`（单边）。端点是 `{file, line, quote, nodeId?, evidence?}`，`evidence` 是额外的引文 `{file, line, quote}`（前缀所在行、基地址定义行、导入行）。合并逐条核对，任一条不过，端点进 `quote-failed` 并带原因：

1. `malformed`：字段缺失或类型不对、种类不认识；
2. `outside-root`：路径越出项目根（不读，只计数）；
3. `outside-area`：端点文件不是本区的文件（证据文件不受此限）；
4. `line-out-of-range`；
5. `quote-mismatch`：引文去掉首尾空白、压缩空白后，不是该行起 3 行（压缩空白后拼接）的子串，或短于 4 个字符；
6. `evidence-mismatch`：任一证据引文按第 5 条对不上；
7. `address-not-quoted`：地址的字面部分不在端点行起 4 行与证据行（各自起 4 行）里。按种类：`http` 的每个非参数路径段（须作为完整的词出现，前后不紧贴字母、数字或下划线：`oauth` 不算出现在 `oauthGp` 里）与方法名（`GET` 例外，它是多数客户端的默认）；`rpc` 的方法名；`message`、`realtime` 的通道名去掉占位符后的每个字面片段；`external` 的端点名或主机（不分大小写）。路径与知识图里同一文件同一行的路由入口点的 `path` 规范化后相同的，地址按入口点核过（`addressBy: entry-point`）。

`nodeId`：给了且在知识图里、节点文件就是端点文件的，保留；否则计入 `nodeIdRejected` 并改为推导：同文件、行范围包含该行的最窄节点，再退到文件节点，再退到 `null`。来源写在 `nodeIdBy`（`analyzer`、`derived-range`、`derived-file`、`none`）。节点 id 是结构化事实，以脚本推导为准，模型给的只核对。

**残余：** 把真行配到错误的单元（引了别的 `Group` 的前缀行）过得了全部核对。验收的分层抽查专门覆盖它。

### D6 地址规范化与配对

规范化地址（`relations-address.mjs`，纯函数）：

- `http`：方法大写（`ANY`/`ALL` 与任何方法相同）；路径去掉协议与主机（主机另记）、查询串与片段，合并重复的 `/`，去掉末尾 `/`；`:x`、`{x}`、`<x>`、`${...}`、`[x]` 写成参数段 `{}`，`*`、`**`、`*x`、`[...x]` 写成通配 `{*}`，通配吃掉其后所有段。键为 `METHOD /a/{}/b`。
- `rpc`：服务名取最后一个 `.` 之后的部分，加方法名，键为 `Service/Method`。
- `message`、`realtime`：通道或事件名去掉首尾空白，占位符写成 `{}`。
- `external`：主机小写、去掉端口与 `www.`；没有主机时用名字小写。接收端是外部端点 `external:<名字>`，不是代码里的一端。

没有地址、或地址里没有任何字面部分（整条路径是变量）的端点进 `address-unresolved`。

配对只在不同的「侧」之间进行。侧是单元加语言族（`js`、`go`、`jvm`、`python`、`dotnet` 等，按扩展名）：一个 Spring 应用把 Angular 前端放在同一清单下时，浏览器代码与服务端是两侧，照样配对；同一个 Node 服务的两个文件是一侧，不配（同一进程内的调用不是单元间通信）。代价：同一单元、同一语言族的前后端（例如 Node 服务目录里的浏览器脚本）配不上，进 `caller-only`/`receiver-only`，看得见。调用端写了 `targetUnit`（指向哪个单元，须在单元清单里，可以是它自己的单元）时，只在该单元里找接收端；清单里没有的 `targetUnit` 计数后忽略：
- `http`：段数相同（通配除外），逐段满足「接收端是参数则任意，是字面则调用端须为相同字面或参数」，方法相同。按字面段相同的数目取最多者；并列时，不需要「调用端变量等于接收端字面段」的接收端胜出（调用端 `/policy/${id}` 配 `/policy/:id` 而不是 `/policy/tags`）。唯一则 `linked`，多个则 `ambiguous` 并列出候选，没有则 `caller-only`。
- `rpc`、`message`、`realtime`：键相同即配；多个接收端都配上时，`message` 与 `realtime` 是一对多的广播，每个都 `linked`；`rpc` 多个为 `ambiguous`。
- `external`：调用端核对通过即 `linked` 到具名外部端点。

### D7 桶与守恒

端点的桶，恰好一个：
- 调用端：`linked`、`ambiguous`、`caller-only`、`address-unresolved`、`quote-failed`；
- 接收端：`linked`（至少一个调用端配到它）、`receiver-only`、`address-unresolved`、`quote-failed`。

分析器注意到的后续种类按种类计入 `out-of-scope`。区内重复的端点（同端、同种类、同文件、同行、同地址键）保留一条并计数。守恒：分析器写出的端点数 = 各桶端点数之和 + 重复数，MUST 成立，否则退出 4、不写 `relations-graph.json`。

候选文件的桶，恰好一个：`cited`（有端点或证据引到它）、`declared-skip`（分析器在 `skippedFiles` 里写了理由）、`ends-rejected`（分析器在它里面写了端点，但核对全部拒掉）、`silent-zero`（都没有）。非候选的源码文件计数 `not-candidate`；`container` 单元的候选计数 `container-skipped`；读不了的（超过 1 MB 或有超过 2000 字符的行）计数 `unreadable`；测试文件计数 `test-excluded`。单元的桶：`has-candidates`、`no-candidates`。各项之和等于源码文件总数与单元总数。

区的验收同域 skill：没有本次令牌为 `rejected-stale`，不是 JSON 为 `rejected-parse`，没有文件为 `missing`；被拒区的东西不进合并，退出 3。

### D8 一致性测量与升级信号

合并在写新产物之前读旧的 `relations-graph.json`。旧产物的 `inputDigest`（单元摘要、每个候选文件的路径与内容哈希、配置行、信号表版本）与本次相同时，按种类算两次运行 `linked` 键集合的 Jaccard。键是 `种类|调用端文件|地址键|接收端文件或外部端点`，不含行号。输入不同或没有旧产物时一致性为 `null` 并写明原因。

每类关系在覆盖报告的 `measurements` 里记：端点数、`quote-failed` 数与引文失败率、核过的端点里 `address-unresolved` 的占比、`linked` 数、一致性。阈值（动手前写死，写进脚本常量）：

| 量 | 达标线 |
|---|---|
| 一致性 Jaccard | ≥ 0.80（两次 `linked` 键并集少于 5 条的记为样本不足，不判） |
| 引文失败率 | ≤ 10% |
| 未解析占比 | ≤ 30% |

引文失败率与未解析占比只在该种类的端点（未解析占比为核过的端点）至少 10 个时判，少于 10 个的不判。端点数按去重后计。任一不达标的种类列入 `escalation.candidates`，写明哪一项。这只是信号，本变更不建抽取器。

### D9 产物与新鲜度

`.excavator/relations-graph.json`（格式 `excavator-relations/1`，字段值英文）：`sourceRevision`（共享新鲜度助手）、`factDigest`（知识图头部的 `factsDigest`，没有知识图为 `null`）、`inputDigest`、单元、外部端点、每条关系（种类、桶、地址与键、两端、两端单元、候选、理由、区）、桶计数、`out-of-scope` 计数、测量。`relations-freshness.mjs` 按域 skill 的方式判可用：`sourceRevision` 或 `factDigest` 与当前不同即不可用。终端查询用 `jq`，配方写在 `SKILL.md`。

### D10 子代理

新增 `excavator-relations-analyzer`。它只读区上下文与本区文件（证据可以读别的文件），只写区上下文给的输出文件。提示词写明：
- 五类范围与后续种类的清单；
- 端点引文逐字抄；地址写成接收方看到的完整形式，前缀与基地址要有证据行；
- 读不出地址就写 `unresolved` 并说明，读不出另一端就写单边，不猜；
- 每个候选文件要么有端点，要么在 `skippedFiles` 里写理由；
- 不写脚本，不读 `.excavator/` 下的其它产物，不写模型名。

### D11 与 `http-links` 提案的关系

`http-links` 覆盖的前端到后端 HTTP 是本变更 `http` 种类的一部分；它的路径写法与配对规则在 D6 沿用。两者的区别：本变更按区派代理而不是按项目、基地址由分析器带证据写进地址而不是由编排者统一映射、范围多四类。`http-links` 没有实现；本变更合入后，是否撤回它由用户决定，本变更不改它的文件。

## 验收 oracle（动手前写死）

**语料**（都在 `~/Documents` 下的副本上跑，原语料不动；有 F1 的语料用带路由入口点的事实构建先建知识图）：
- go-multirepo：React（axios 实例）、Go gin 与 Node Express 后端、OAuth2 认证服务、SaaS 集成；
- realtime-suite：Vue（axios）、Express、socket.io；
- kotlin-portal：Angular `HttpClient`、Spring；
- contracts-monorepo（留出）：React 加 NestJS、共享契约包。提示词不在它上面调。

**条件：** 每个语料 `claude -p --model sonnet`，单次花费上限 30 美元，一个接一个跑，记花费。

| # | 检查 | 达标线 |
|---|---|---|
| O1 | 装置先验 | 夹具里每个 D5 拒收原因各植入一个假端点，全部被拒且原因正确；去掉植入后真端点全部通过；节点 id 错的被替换并计数 |
| O2 | 守恒 | 每次运行端点、候选文件、源码文件、单元的守恒都成立 |
| O3 | 精度 | 每个语料分层抽查 ≥ 20 条，覆盖每个非空桶，对照源码判对错。`linked` 精度 ≥ 90%；编造（端点或配对在源码里不成立）与遗漏分开算 |
| O4 | 一致性 | go-multirepo、realtime-suite、kotlin-portal 各在同一副本上连跑两次，第二次的报告里有每类的 Jaccard；低于 0.80 的种类照记为抽取器候选，不挪阈值 |
| O5 | 单元复用 | 第二次运行打印 `units=reused`，单元清单逐字节相同 |
| O6 | 留出 | contracts-monorepo 用冻结的提示词跑，报告同 O2、O3；它的结果不触发提示词修改 |

召回没有参照，只报下限（`silent-zero` 文件、`caller-only` 与 `receiver-only` 的数目）与抽查中看到的遗漏。
