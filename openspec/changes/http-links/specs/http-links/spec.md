## ADDED Requirements

### Requirement: 项目与分片

`http-links.mjs plan <项目根>` SHALL 列出项目根下的每个项目，并为每个项目给出一个或多个分片：
- 项目以清单文件为准：`go.mod`、`package.json`、`pom.xml`、`build.gradle`、`build.gradle.kts`、`pyproject.toml`、`requirements.txt`、`Gemfile`、`*.csproj`、`composer.json`、`Cargo.toml`。嵌套的清单归最外层的项目。
- 没有清单文件的顶层目录 SHALL 也是一个项目。
- 一个项目的源文件数超过 `--shard-files`（默认 400）时，SHALL 按它的顶层子目录分成多个分片。

每个分片 SHALL 有一个指纹：分片内每个文件的「相对路径 + 内容哈希」排序后的哈希。`plan` MUST NOT 进入 `.git`、`.excavator`、`node_modules` 与 `vendor`，MUST NOT 跟随符号链接。

#### Scenario: 嵌套清单归外层
- **WHEN** `web/package.json` 与 `web/packages/ui/package.json` 都存在
- **THEN** 只有 `web` 一个项目，`web/packages/ui` 的文件属于它

#### Scenario: 指纹只随内容变化
- **WHEN** 一个分片里的文件内容都没变，只改了别的分片里的一个文件
- **THEN** 这个分片的指纹不变，被改的那个分片的指纹变了

### Requirement: 子代理抽取接口与请求

每个需要运行的分片 SHALL 由一个 `excavator-http-links-reader` 子代理读代码，答复写进编排者指定的一个文件，列出：
- 该分片注册的 HTTP 接口：方法、拼好全部前缀的完整路径，以及可选的处理函数；
- 该分片发出的 HTTP 请求：方法、基地址变量（按本文件的绑定解析到的那个名字）、路径模板。

每条 SHALL 带依据行 `{file, line, text}`：
- 接口：注册行，加上路径每一层前缀所在的行；文件路由以文件路径本身作为依据；
- 请求：调用行，加上基地址在本文件的绑定行；
- 处理函数：名字与它定义所在的行。

提示词与子代理定义 MUST NOT 含任何框架或语言的专门规则，MUST NOT 写模型名。子代理 MUST NOT 写或运行解析代码的脚本，MUST NOT 写答复文件以外的文件。路径无法确定时，子代理 SHALL 把这条请求报为 `path-unknown` 并写出原因，MUST NOT 猜路径。

#### Scenario: 前后端同仓的项目
- **WHEN** 一个项目既注册接口又发请求
- **THEN** 同一个子代理的答复里两种条目都有，编排者不需要先判断它是哪一边

### Requirement: 逐条核对答复

`http-links.mjs check <运行目录> <分片>` SHALL 逐条核对答复里的接口与请求。一条在下列任一项不成立时，SHALL 进入 `unchecked`，带上原因，并且 MUST NOT 参与配对：
1. 依据行的路径解析后在项目根内；越界的路径 MUST NOT 被读取；
2. 行号在文件范围内；
3. `text` 与那一行去掉首尾空白后相同；
4. 完整路径里的每个字面段（参数段与通配除外）出现在某条依据行、注册行或调用行起的 3 行之内，或依据文件路径里；
5. 方法名出现在注册行或调用行起的 3 行之内（不区分大小写），或这几行里有 `method`；
6. 有处理函数时，它的名字出现在注册行起的 3 行之内，也出现在它的定义行里。

`check` 的规则 MUST NOT 依赖框架或语言：只比较文本。

#### Scenario: 原文不符
- **WHEN** 一条接口的注册行 `text` 与文件里那一行不同
- **THEN** 这条进 `unchecked`，原因写明原文不符，配对里没有它

#### Scenario: 真行配假路径
- **WHEN** 一条接口的依据行都真实存在，但完整路径里有一个字面段在所有依据行里都没出现
- **THEN** 这条进 `unchecked`，原因写出那个段

#### Scenario: 越界路径
- **WHEN** 依据行的 `file` 是 `../other/x.go`
- **THEN** 不读这个文件，这条进 `unchecked`

### Requirement: 基地址映射与交叉验证

编排者 SHALL 为每个子代理报出的基地址变量判断它指向哪个项目，写出依据行，或者写 `null` 表示语料里没有它指向的项目。依据行 SHALL 按「逐条核对答复」的第 1–3 条核对，不过的依据从映射里去掉。

`pair` SHALL 为每个基地址、每个项目算路径重合度：这个基地址的请求里，路径（不看方法）能配上该项目某个接口的比例。判断成立，要求编排者选的项目是重合度最高的项目，且重合度不低于 50%。不成立时，映射 SHALL 标为冲突，写出各项目的重合度，这个基地址的请求 SHALL 全部进入 `base-conflict`。

#### Scenario: 局部重绑的同名变量
- **WHEN** 两个文件里同名的局部变量绑定了不同的配置项，而答复把它们认成同一个基地址
- **THEN** 这个基地址对任何项目的重合度都低于 50%，映射标为冲突，它的请求进 `base-conflict`

### Requirement: 确定性配对与桶

`http-links.mjs pair <运行目录>` SHALL 按以下规则配对。

路径统一写法：
- 按 `/` 切段，去掉查询串；
- `:x`、`{x}`、`<x>`、`${...}`、`[x]` 是参数段；
- `*x`、`**`、`[...x]` 是通配，匹配其后所有段。

一个接口是请求的候选，要求：
- 它在基地址映射给出的项目里；
- 段数相同（有通配时除外）；
- 逐段满足：接口段是参数时，请求段任意；接口段是字面时，请求段是相同字面，或者请求段是参数（记为参数对字面）；
- 方法相同，或接口方法为 `ANY`、`ALL`。

结果：
- 字面段相同最多的候选只有一个：`matched`，有参数对字面时带标记；
- 并列多个：`ambiguous`，列出候选；
- 只有方法不同的候选：`verb-differs`；
- 没有候选：`no-endpoint-path`。

每条请求 SHALL 恰好落进 `matched`、`ambiguous`、`verb-differs`、`no-endpoint-path`、`base-unmapped`、`base-conflict`、`unchecked`、`path-unknown` 之一，各桶之和 MUST 等于请求总数。

#### Scenario: 字面胜参数
- **WHEN** 请求 `GET /v2/leaves/export`，项目里有 `GET /v2/leaves/export` 与 `GET /v2/leaves/:id`
- **THEN** 请求 `matched` 到 `/v2/leaves/export`

#### Scenario: 参数请求对两条字面路由
- **WHEN** 请求 `GET /r/{}/role/{}`，项目里有 `GET /r/:id/role/admin` 与 `GET /r/:id/role/main`
- **THEN** 请求进 `ambiguous`，列出两个候选

### Requirement: 防漏读绊线

`plan` SHALL 用一组与框架无关的模式，列出每个分片里疑似注册或疑似请求的行。`pair` SHALL 把这样的文件写进产物的 `possiblyUnread`：有命中，但没有任何依据行来自它。编排者 SHALL 对这些文件补派一次读取；补读后仍没有条目的文件 SHALL 留在 `possiblyUnread` 里。绊线 MUST NOT 拦下运行，也 MUST NOT 改动任何桶。

#### Scenario: 漏读的文件
- **WHEN** 一个文件里有 `.post("/x"`，但答复里没有任何依据行来自这个文件
- **THEN** 它出现在 `possiblyUnread` 里，并被补读一次

### Requirement: 缓存与续跑

再次运行时，指纹与上次产物相同的分片 SHALL 沿用上次的答复，MUST NOT 派子代理；`--fresh` 时 SHALL 全部重跑。有任一分片重跑时，SHALL 重新判断基地址映射。中断后再运行，已核对的分片答复 SHALL 沿用。

#### Scenario: 只改一个文件
- **WHEN** 上次运行之后只改了一个项目里的一个文件
- **THEN** 只有那个分片派了子代理，其余分片的答复与上次逐字节相同

### Requirement: 产物 http-links.json

`pair` SHALL 写出 `.excavator/http-links.json`（或 `--out` 指定的目录），格式串 `excavator-http-links/1`，内容包括：
- `sourceRevision`；
- `shards`：每个分片的指纹、状态、接口、请求；
- `baseMapping`：判断、依据行、各项目重合度、是否冲突；
- `pairs`：每条请求的桶与配上的接口；
- `counts`：各桶计数，以及接口被配上的数目；
- `possiblyUnread`；
- `residualAssumptions`：至少写明路由器的匹配顺序没有建模。

字段值 SHALL 用英文。产物 MUST NOT 写进知识图，skill MUST NOT 改动 `.excavator/` 里的其他文件。

#### Scenario: 语料里没有前端
- **WHEN** 项目根下只有后端项目
- **THEN** 产物照常写出：请求为 0，各桶计数为 0，接口照常列出

### Requirement: /excavator-http-links skill

`/excavator-http-links` SHALL 按 `plan` → 分片读取 → `check` → 基地址映射 → `pair` → 补读 `possiblyUnread` → `pair` 的顺序运行。每份答复一返回 SHALL 立即 `check`。最后的回复 SHALL 由最后一条命令打印固定格式的几行：各桶计数、接口数、冲突的基地址、`possiblyUnread` 的文件数、产物路径。skill MUST NOT 给出建议。

#### Scenario: 回复的最后几行
- **WHEN** 运行结束
- **THEN** 回复以 `pair` 打印的固定几行结束，计数与产物里的 `counts` 相同
