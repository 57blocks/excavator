## Context

- Skopo 的恢复流程目前是 Skopo 仓库 `tools/harness-plugins/claude-code` 里的 `/skopo:init`（8 个阶段：普查、研究、计划、写 spec、写绑定、README 与 rationale、lint 到干净、问题、收尾），配一个只读研究代理和 `tools/cli` 里的脚本：`spec.mjs`（解析）、`lint.mjs`（L 检查）、`assign-ids.mjs`（把占位 ID 换成随机 ID）、`inventory.mjs`（普查）、`run.mjs`（运行记录：阶段、lint 轮次、指标）、`keywords.json`（各语言的规范关键字）。写作规则在 `guide.md` 与 `examples.md`。
- 这些脚本零依赖，只用 Node 标准库；`keywords.json` 含中文关键字（`应`、`不应`、`可` 等）。Skopo 仓库用 `tools/sync-harness-plugins.mjs` 把 `tools/cli` 复制进各个插件：插件只安装自己的目录。
- `/skopo:init` 在计划后问一次用户（`--auto` 跳过），遇到阻断问题（仓库不在默认分支、目标已有 skopository）停下来问；每次运行新建 `.skopo/runs/<id>/`，没有续跑；skopository 写在 `<repo>/skopo/`。
- `/skopo:init --with-excavator` 把 Excavator 的图谱文件路径交给研究代理，让它用 `rg` 去搜。两次实地运行里这个图谱没有帮上任何一个研究镜头。
- Excavator 这边：事实层零模型，覆盖 Java EE 的按名与按类型注入、业务接口、JAX-RS 路由、描述符里类名的提及，以及 JSF 的 EL 引用与导航规则提及（规格 `javaee-framework`、`jsf-framework`、`fact-graph`）；MCP 提供 `project_status`、`recall`、`traverse`、`read_evidence`（`mcp-tool-surface`）；`consumer-freshness.mjs` 给出当前源码修订与事实层是否新鲜。`excavator-prd-report` 定义了 `--out`、`--scope`、`--fresh`、续跑与 `--language` 的写法。
- runner 镜像（`runner-image`）只有 `lazy` 与 `full`，`full` 用固定参数启动 `claude -p`，再由确定性检查判定加载、运行与产物。

## Goals / Non-Goals

**Goals**
- 在 Excavator 里用三个命令完成 Skopo 恢复：计划、写出、报告；无人值守，可续跑，可在 runner 镜像里跑。
- 研究代理用上事实层与 MCP；Java EE 项目有专门的意图来源指引。
- Skopo 的检查器与写作规则只有一个源头（Skopo 仓库），Excavator 里的副本不被本地改动。
- 报告里会被漏掉或改写的部分（问题、决定、覆盖、lint）由脚本生成并守恒。

**Non-Goals**
- 见 proposal 的「不做」。

## Decisions

### D1 为什么写代码（AI-first scope gate）

- 检查器（解析、L 检查、ID 分配、普查、运行记录）是机器校验与持久化契约，已经在 Skopo 仓库里写成代码：原样带进来，不重写。
- 续跑判定（运行目录是否属于本 skill、源码修订与范围是否一致、做到哪一步）是持久化契约：写进 `skopo.mjs status`，不让模型自己比对文件。
- 报告的问题表、没有记录理由的决定、范围与覆盖、lint 结果是全表事实：模型转写会漏行与改序，由脚本生成。总结里引用的 statement ID 是否存在、种类是否一致，由脚本核对。
- 报告页把模型写的 Markdown 变成 HTML：安全边界，由脚本做，只认一个转义优先的小子集。
- runner 的产物判定（`verdict`）是确定性判定：不读模型的自述。
- 研究、计划、写作、问题的措辞、总结是判断：留在 skill 与提示词里。

### D2 目录与命名

```
skills/skopo-plan/SKILL.md
skills/skopo-create/SKILL.md
skills/skopo-create/skopo.mjs            确定性 CLI（D5）
skills/skopo-create/lib/*.mjs
skills/skopo-create/jakarta-ee.md        Java EE 的意图来源（D8）
skills/skopo-create/researcher-dispatch.md  派发研究代理的规则，plan 与 create 共用
skills/skopo-create/checker/             vendored（D3）
skills/skopo-report/SKILL.md
agents/skopo-researcher.md
```

`skopo.mjs` 与共用文件放在 `skopo-create` 下：它是三者里唯一必需的一个，另外两个按 `$PLUGIN_ROOT/skills/skopo-create/...` 引用。名字沿用 Skopo 的术语（skopository、spec、binding），命令名是 `skopo-plan`、`skopo-create`、`skopo-report`，在 Claude Code 里是 `/excavator:skopo-plan` 等。

### D3 vendored 检查器

- `checker/` 收 `spec.mjs`、`lint.mjs`、`assign-ids.mjs`、`inventory.mjs`、`run.mjs`、`keywords.json`、`guide.md`、`examples.md` 与 Skopo 的 `tools/LICENSE`（Apache-2.0）。`newid.mjs`、`lock.mjs`、`semantic.mjs`、`semantic-prompt.md` 不收：本变更不用。
- `.mjs` 与 `.md` 逐字节复制。`keywords.json` 含中文，而仓库的中文门禁覆盖 `skills/`：副本把每个非 ASCII 字符写成 JSON 的 `\u` 转义，解析后与源文件相同。
- `checker/SOURCE.json` 记录来源仓库、来源 commit，以及每个文件的 SHA-256：`.mjs`、`.md`、`LICENSE` 按字节；`keywords.json` 按 `JSON.stringify(JSON.parse(text))`。测试重算每个文件，任何不一致都失败；`SOURCE.json` 列出的文件与目录里的文件必须一一对应。
- 更新副本由 Skopo 仓库那一侧完成（复制并重写 `SOURCE.json`），不在本仓库手改。
- `NOTICE` 加一段：`skills/skopo-create/checker/` 来自 Skopo，Apache-2.0，许可证文本在该目录。

### D4 产物目录与续跑

`$OUT` 默认 `$PROJECT_ROOT/.excavator/skopo`，三个命令共用：

```
$OUT/run/run.json        format "excavator-skopo/1"、projectRoot、sourceRevision、scope、plugin、阶段、lint 轮次、决定
$OUT/run/inventory.json  research/<lens>.md  plan.md  ids.json  questions.md  notes.md  lint/NN.txt  metrics.json
$OUT/skopo/              skopository（skopo-create）
$OUT/report/summary.md   模型写（skopo-report）
$OUT/report/report.md    report.html   脚本写
```

- `run.json` 的形状与 `run.mjs start` 写的一致，另加 `format`、`projectRoot`、`sourceRevision`、`scope`；`plugin` 记 `excavator@<package 版本>`。所以 vendored 的 `run.mjs set|phase|lint|finish` 可以直接作用在 `$OUT/run` 上；`run.mjs start` 不用（它固定写到 `<workspace>/.skopo/runs/`）。
- `skopo.mjs status <out> --project <root> --revision <rev> [--scope <s>]` 打印一行 JSON，`state` 恰好是以下之一：
  - `none`：`$OUT` 不存在或为空；
  - `foreign`：`$OUT` 非空，却没有本格式的 `run/run.json`；
  - `stale`：`sourceRevision` 与当前不同；
  - `other-scope`：`scope` 与本次不同；
  - `started`：已开始，没有计划；
  - `planned`：有非空 `plan.md`，`decisions.plan` 已记录；
  - `created`：`skopo/skopo.json` 存在且 `run.json` 有 `endedAt`。
- `skopo.mjs start` 只在 `none` 时建目录；`skopo.mjs fresh <out>` 只删除空目录或本格式的目录，`foreign` 时拒绝。
- 续跑规则写在 skill 里：`stale` 与 `other-scope` 停下，提示用 `--fresh`；`started` 时已保存的研究报告不重派；`skopo-create` 在 `planned` 上从写 spec 开始，每次开始写之前删除 `$OUT/skopo`，因为写到一半的 skopository 不能可靠续写；`created` 时 `skopo-create` 不重写，提示用 `--fresh`。
- 源码修订取 `consumer-freshness.mjs` 的 `currentSourceRevision`：Git 仓库与普通目录都有。

### D5 `skopo.mjs`

零模型，只读目标项目，只写 `$OUT`。子命令：`start`、`status`、`fresh`、`report-check`、`report-assemble`、`report-page`、`verdict`。退出码：0 成功；1 检查失败，每个原因一行；2 不能运行（参数、文件缺失）。普查、ID 分配、lint、阶段与指标直接调用 `checker/` 里的脚本。

### D6 `skopo-plan` 与 `skopo-create` 的流程

从 `/skopo:init` 移植，改动如下：

- **不问用户。** 计划之后不停，等于 `--auto`。阻断问题记下 `stopped=<原因>`，告诉用户并结束：`foreign`、`stale`、`other-scope`、仓库处在一个不是默认分支的具名分支上。分离 HEAD 或看不出默认分支时不阻断：写进 notes 与 README 的「What is not here」，继续。runner 在 checkout 一个 commit 时就是分离 HEAD。
- **范围。** `--scope <dir>` 是项目内的相对路径：普查与研究只覆盖它，研究代理可以追到范围外的调用方与被调用方，但不为范围外写 statement。没有 `--scope`、而普查超过约 30 万行代码或 150 万字文档时，`skopo-plan` 只派 `world` 与 `design` 两个模块级的研究，计划写出按域或按模块的切分、每块的行数与建议的第一块范围；`skopo-create` 遇到这样的计划时停下，提示带 `--scope` 重跑。
- **事实层。** 事实层新鲜时，派发里给 `GRAPH=available`：研究代理先用 MCP（连接时）或在 `.excavator/knowledge-graph.jsonl` 里 `Grep` 找路，再读源码。过期或缺失时只报告，不重建（与 `excavator-prd-report` 一样不跑 `/excavator`）。`--no-graph` 关掉它，用于对照。
- **运行数据位置。** 运行目录是 `$OUT/run`，skopository 是 `$OUT/skopo`。
- **语言。** 对用户说的话用 `--language`（与其他 skill 同一段规则）；skopository 本身的语言由计划决定，默认英文，与 Skopo 的规则一致。
- 其余（研究镜头与拆分、计划的内容、写作顺序、逐域分配 ID 与 lint、问题的格式与分类、lint 五轮上限、notes 的格式、不写 lock）按 `/skopo:init` 原样，写作规则读 vendored 的 `guide.md` 与 `examples.md`。

### D7 `skopo-report`

- 输入：`$OUT/skopo` 与 `$OUT/run`；`run.json` 没有 `endedAt` 时停下，提示先跑 `skopo-create`。
- 模型写 `$OUT/report/summary.md`：第一行 `# <系统名>`；目的、消费方与产品、每个域的要点与原则、最该先看的五个问题为什么重要。每个段落、列表项与表格数据行至少引用一个 statement ID。它 MUST NOT 写脚本拥有的小节标题。
- `report-check` 核对 summary：第一行是 `#` 标题；每个被引用的 ID 在 skopository 里存在且种类一致；没有占位 ID；每个段落、列表项与表格数据行至少有一个 ID；没有脚本拥有的标题。
- `report-assemble` 写 `report.md`：summary，然后 `## Status`（是否已 lock、源码修订、范围）、`## Questions`（按后果排序：security、money、regulation、promise、behaviour、documentation，类内保持原编号顺序；输出行数等于 `questions.md` 的行数；类别不在这六个里时失败）、`## Decisions without a recorded reason`（原样搬运，没有时写一句没有）、`## Scope and coverage`（statement 计数、源码规模、README 的「What is not here」、最后一轮 lint 的错误与警告数）。
- `report-page` 写 `report.html`：一个文件、无外部资源、从磁盘双击打开。Markdown 只认标题、段落、列表、表格、粗体、行内代码与代码块；先整体转义 HTML，再套这些结构；不生成链接，不放原始 HTML，没有脚本。

### D8 Java EE 的意图来源

`jakarta-ee.md` 按镜头写 Excavator 事实层没有变成边、但意图集中的地方，以及每处怎么找（`recall` 的词、`Grep` 的模式），例如：Facelets 里 `rendered`/`disabled` 的 EL 条件（页面上的权限与业务规则）、`@RolesAllowed` 与 `web.xml` 的 `security-constraint`、`@Schedule` 与 `@Timeout`、`@TransactionAttribute`、Bean Validation 注解、`messages*.properties`（用户看到的拒绝原文）、`@Version`、级联与 `orphanRemoval`、存储过程与 WSDL。编排者在普查或事实层显示 Java EE（`faces-config.xml`、`ejb-jar.xml`、`persistence.xml`、`beans.xml`，或 `javax.`/`jakarta.` 的 `ejb`、`faces`、`persistence`、`enterprise` 导入）时，在每个派发里给 `STACK=` 这个文件。它是提示，不是证据。

### D9 研究代理

`agents/skopo-researcher.md` 从 Skopo 的 `researcher.md` 移植：镜头、规则与报告格式不变；派发参数增加 `GRAPH`、`STACK`，`MAP` 去掉；`read_evidence` 返回的是当前源码，可以按源码引用；图谱与 `STACK` 永远不是证据。只读：不写文件、不改项目。

### D10 runner 的 skopo 模式

- `EXCAVATOR_MODE` 取值增加 `skopo-plan`、`skopo-create`、`skopo-report`；它们与 `full` 一样要求 `AWS_REGION`、`ANTHROPIC_MODEL`、`EXCAVATOR_MAX_BUDGET_USD`，使用 `EXCAVATOR_TIMEOUT_MINUTES`。新参数 `EXCAVATOR_SCOPE`：可选，只用于 `skopo-plan` 与 `skopo-create`，必须是不含 `..` 的相对路径；在其他模式下给出是配置错误。
- 流程：
  1. 事实层不新鲜时先跑 lazy（零模型，与 `lazy` 模式同一个脚本），失败为运行失败；
  2. 以与 `full` 相同的隔离参数启动 `claude -p "/excavator:skopo-<stage> /work/repo --out /work/out/skopo [--scope <s>]"`；
  3. 加载检查与运行检查沿用 `full` 的；
  4. 产物检查是 `skopo.mjs verdict /work/out/skopo --stage <stage> --project /work/repo`。
- `verdict` 的条件：
  - `plan`：`run.json` 是本格式、源码修订等于当前、`plan.md` 非空、至少一份研究报告、`decisions.plan` 已记录、没有 `stopped`；
  - `create`：以上，加上 `skopo/skopo.json` 存在、对 `skopo/` 重跑 vendored lint 为 0 错误、运行数据里的 ID 引用都在 skopository 里、`endedAt` 已写、`questions.md` 存在；
  - `report`：`report.md` 与 `report.html` 存在且 `report-check` 通过。
- 三个阶段是三次容器运行，共用同一个 `/work/out`：`skopo-create` 在 `skopo-plan` 的产物上续跑。
- 退出码不变：产物不合格是 4；skopo 模式没有编造阶段。摘要沿用 `full` 的格式，`mode` 是 skopo 模式名，编造检查为空。
- 代码放在新文件 `deploy/skopo-mode.mjs`；`run-excavator.mjs` 只加分派与参数。

## Risks / Trade-offs

- **副本漂移**：Skopo 仓库改了检查器，Excavator 不会自动跟上。`SOURCE.json` 让副本的版本可见、本地改动不可能；跟上要一次更新提交。
- **大 PR**：四个能力与 runner 一起审。按 commit 分步，见 tasks。
- **MCP 在 runner 里绑定的是临时 cwd**：MCP 的项目根是 Claude Code 打开的目录。runner 从空目录启动，研究代理在 runner 里会退到 `Grep` 图谱文件。这与 `excavator-prd-report` 的退路相同，不另做处理。
- **规范性陈述与「零编造」**：spec 写的是「必须」，不是代码现状。skopository 是提案，每条陈述在研究报告里有源码证据，分歧进问题清单；报告的「Status」一节写明未经人确认。

## Acceptance oracles

动手前写定，实现后逐条记录结果。

- **O1 门**：`node scripts/check-refs.mjs`、`pnpm test`、`pnpm run typecheck`、`openspec validate --all --strict` 全部通过。
- **O2 副本**：测试先证明自己看得见：改动副本中任一文件一个字节、删掉一个文件、多放一个文件，测试都失败；未改时通过。`keywords.json` 副本只含 ASCII，解析后与 `SOURCE.json` 记录的哈希一致。
- **O3 状态与续跑**：`status` 对 7 种状态各有一个夹具并给出对应结果；`start` 在非 `none` 时拒绝；`fresh` 在 `foreign` 时拒绝且不删任何文件。
- **O4 报告**：`report-check` 对以下各有失败用例：缺 ID 的段落、不存在的 ID、种类不符的 ID、占位 ID、脚本拥有的标题、第一行不是 `#`；`report-assemble` 输出的问题行数等于输入且按类别排序，未知类别失败；`report-page` 对 `<script>`、`<img onerror>`、`[x](javascript:…)` 输出转义文本，页面里没有 `<a`、`<script`。
- **O5 判定**：`verdict --stage create` 在一个合规的夹具 skopository 上通过；把其中一条 statement 的锚点改坏后失败并打印 lint 错误；删掉 `endedAt` 后失败。
- **O6 runner**：配置测试覆盖新模式与 `EXCAVATOR_SCOPE` 的合法与非法取值；用假的 `claude` 跑一次 `skopo-create`，产物合规时退出 0，不合规时退出 4；文档的参数表与 `RUNTIME_PARAMS` 一致。
- **O7 真实冒烟**：本地 Claude Code（`--plugin-dir` 指向本检出），在一个小的开源 Java EE 项目上依次跑 `/excavator:excavator`（lazy）、`skopo-plan`、`skopo-create`、`skopo-report`：每一步的 `verdict` 通过，`report.html` 能打开；记录 token、花费与墙钟，以及研究报告里事实层帮上了多少。

## 验收记录

（实现后填写。）
