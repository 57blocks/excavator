## Context

- `excavator-prd-report`（规格 `prd-report`）由泳道各写一章，`assemble` 按 `chapter` 顺序拼成 `PRD.md`：总览、角色表、各章、附录。单篇 `excavator-prd`（规格 `prd-generation`）由一个代理写全文。
- 在同一个 51 文件的后端成员上各跑一次（`--scope` 指向该子目录）：单个流程的写法两边一致；差在文档骨架、前端一侧与一个失败功能整章缺席（见 proposal 的 Why）。
- 章节 front-matter 由 `lib/front-matter.mjs` 读，只支持标量、`[a, b]` 与 `- item` 字符串列表；新字段都在这个子集里。
- `excavator-verify --fix` 会在被核对文档的文末追加核对摘要，标题级别不固定（真实运行里有 `##` 也有 `###`）。
- 本变更在 `prd-report-finding-priority` 合并之后实现，基于它的 `aggregate`、`reply` 与报告页。

## Goals / Non-Goals

**Goals**
- 拼出的 `PRD.md` 有单篇的文档骨架：术语表、能力地图、流程索引、全局角色与权限、集中的待确认项、核对只在附录。
- 骨架里的表与索引全部由脚本从结构字段生成，模型只写叙述与声明。
- `--scope` 指向子目录时，流程的前端与调用方一侧有内容。
- 一个功能的失败不会因为编排者漏了重派而静默停在第一次。

**Non-Goals**
- 见 proposal 的「不做」。

## Decisions

### D1 为什么写代码（AI-first scope gate）

- 术语表、流程索引、角色两张表、待确认项的汇集、范围外读取的计数是全表事实：模型转写会漏行、改名、错链接，所以由脚本从 `index.json` 与章节 front-matter 生成。
- 哪些是流程、哪些角色是参与者、哪些是权限角色、哪些事项待确认是判断：由泳道写进 front-matter，脚本只核对声明与正文一致。
- 能力地图（消费方表与能力流程图）是概括性叙述，由编排者写进总览；脚本只检查总览有 mermaid 图。

### D2 共享模型章节：`kind: "reference"`

- 功能的 `kind` 增加 `reference`：多个流程共用的模型（角色与权限、令牌或会话模型、共用的状态字典）。章节写字典表（值 | 含义）、角色 × 能力矩阵、判定过程与一张图；流程章节引用它，不重复。
- `reference` 功能的 `entrypoints` 可以为空，`seedFiles` 必填；它的 findings 与其他功能相同。
- `check-index`：所有 `reference` 功能的 `chapter` 小于所有 `flow`、`automated` 功能的 `chapter`，否则打印 `F<n>: reference chapter <c> comes after flow chapter <c2>`。
- Phase 1c：范围内有权限模型（角色、策略、守卫）时，SHALL 建一个名为 `Roles and permissions`（译成 `$LANGUAGE`）的 `reference` 功能，种子为定义角色、状态、策略与守卫的文件；其他被多个流程共用的模型同样处理。

### D3 章节 front-matter 的新字段与 `check-lane` 检查

```markdown
---
id: F1
name: Sign-in and token refresh
kind: flow
actors: [Employee, Third-party application]
permissionRoles: [normal, admin]
triggers:
  - ...
flows:
  - "Flow 1: Password sign-in"
  - "Flow 2: Google sign-in"
openItems: Open items
chapter: 2
---
```

- `roles` 删除，换成 `actors`（发起或参与流程的用户类别与外部系统：员工、客户、第三方应用、其他服务、运维）与 `permissionRoles`（权限模型里的具名角色，原样拼写）。两者都是列表，可以为空。
- `flows`：本章每个流程的 `###` 标题，与正文里的标题逐字相同。`flow` 与 `automated` 功能至少一个；`reference` 功能为空列表。
- `openItems`：集中列出本章待确认项的那个 `###` 标题（标题文字用 `$LANGUAGE`），没有待确认项时省略该键。这一小节是本章最后一个 `###`；内容是表格（事项 | 搜过什么）或列表。
- `check-lane` 新增的问题行（每种各一个测试，见 O2）：
  - `front-matter roles is no longer read; write actors and permissionRoles`（出现 `roles` 键）；
  - `front-matter actors is not a list` / `permissionRoles is not a list` / `flows is not a list`；
  - `<name> is both an actor and a permission role`；
  - `flow "<title>" is not a ### heading of the chapter`；
  - `a flow feature lists no flow` / `an automated feature lists no flow` / `a reference feature lists flows`；
  - `open items heading "<h>" is not a ### heading of the chapter` / `open items heading "<h>" is not the last ### heading`；
  - `the chapter has <n> ## headings; it has one, ## <name>, as its first heading`（正文的 `##` 标题恰好一个且是第一个标题）。
- `aggregate` 对已核对的章节也重算这些检查（它本来就对每个写成的功能重跑 `laneResult`），所以核对改坏了结构时功能变为 `failed`，原因可见。

### D4 拼装顺序与脚本生成的小节

`PRD.md` 依次为（脚本生成的标题与固定词为英文）：

1. `overview.md`：`# <标题>`、Doc Info、目的与能力地图（消费方表与一张 mermaid 能力图）、自动行为。总览 MUST NOT 写词表、角色、流程清单与待确认项。`assemble` 检查总览以一个 `#` 标题开头、含至少一个 mermaid 块，否则退出 1 并打印 `index: overview.md ...`。
2. `## Terminology`：`| Term | Meaning |`，按 `index.json` 的 `glossary` 顺序；`aggregate` 写 `tables/terminology.md`。
3. `## Flow index`：`| # | Flow | Feature | Kind |`。每个写成的功能按章节顺序：`reference` 功能一行（`#` 为功能 id，`Flow` 为章节名），其他功能每个 `flows` 一行（`#` 为 `<id>.<n>`）。`Flow` 一格是指向该标题的链接；锚点按 GitHub 的规则从拼好的全文算出（小写、去掉标点、空格变 `-`、重复的依次加 `-1`、`-2`），所以由 `assemble` 生成。
4. `## Roles`：`### Actors by feature`（行是写成的功能，列是全部 `actors`，按首次出现的顺序）与 `### Permission roles`（`| Role | Features |`，角色按首次出现的顺序）；`aggregate` 写 `tables/roles.md`。
5. 各章，按 `chapter` 顺序（`reference` 在前，见 D2）。每章去掉它的 `openItems` 小节。
6. `## Open items`：每个有待确认项小节的功能一个 `### <id> <name>`，下面是该小节的原文；都没有时为 `None.`。`aggregate` 写 `tables/open-items.md`。
7. `## Appendix`：覆盖、核对、失败的功能、未写成的功能，同前；覆盖小节加一行范围外读取（D7）。

同一输入 SHALL 得到字节相同的 `PRD.md`。章节拆分（正文、`openItems` 小节）由一个函数完成，`assemble`、`aggregate` 与 `page-data` 共用。

### D5 核对摘要不进章节：`excavator-verify --no-summary`

- `excavator-verify` 新增 `--no-summary`：与 `--fix` 同用时，不在文档末尾追加核对摘要；报告照常写计数。没有 `--fix` 时它不起作用。
- `excavator-prd-report` Phase 3 核对每章时带 `--no-summary`。计数在附录的核对表里（已有），完整报告在 `verification/<id>.md`。
- 若核对仍在章节里加了 `##` 标题，D3 的单一 `##` 检查使该功能 `failed`，不静默。

### D6 失败后的下一步写在命令输出里

- `check-lane` 失败（含 `lane-wrote-nothing`）时最后一行打印下一步：`attempts` 小于 2 时 `Next: delete <id>'s files, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`；否则 `Next: <id> stays failed (2 of 2 attempts)`。SKILL.md 第 3 步改为「照 `Next:` 行做」。
- 重派前删的文件补上核对产物：Phase 2 第 1 步与 `Next:` 行所说的「删掉它的文件」都是 `features/<id>.md`、`findings/<id>.json`、`verification/<id>.txt`、`verification/<id>.md`。原来只删前两个：一个在核对步骤失败（`attempts` 1）的功能重派后，旧的 `verification/<id>.txt` 留着，`aggregate` 又把它判为核对失败，新章节从未被核对。契约测试钉住这四个路径。
- `summarize` 加 `retryable`：`failed` 且 `attempts` 小于 2 的功能 id，按章节顺序。`reply` 在计数行之后、无模式框架行之前，`retryable` 非空时打印 `Retry: <ids> failed after one attempt; running the same command again retries them`（id 以空格分隔）。

### D7 范围外的调用方

- Phase 1c：`--scope` 指向子目录时，编排者在范围外搜寻范围内每个入口的调用方（发出该请求的页面与客户端、调用它的其他服务），把含调用方的文件加入该功能的 `seedFiles`。这些调用方自己的流程仍在范围外，不建功能。
- 泳道提示词：种子文件里有范围外的调用方时，Frontend 与衔接部分据此描述。
- 覆盖小节：`index.scope` 是项目内存在的目录时，脚本把不在该目录下的种子文件按第一级目录计数，打印 `Seed files read outside the scope: <dir> <n>, ...`；没有时 `Seed files read outside the scope: none.`；`scope` 为空或不是目录时没有这一行。

### D8 锚点只指项目代码

- 泳道提示词：只引用项目根内的文件；项目外的代码（依赖缓存、标准库、安装的包）不能作为证据，依赖的行为按项目自己的代码与配置描述，或写成待确认。
- `check-lane` 拒绝路径含入口扫描跳过的目录段（`SKIPPED_DIRECTORIES`：`node_modules`、`vendor`、`dist`、`build` 等）的锚点与引文：`anchor <a>: the path is under <dir>, which holds dependencies or build output, not the project's code`。`check-index` 对种子文件做同样检查。

### D9 格式升级

- `index.json` 的 `format` 升为 `excavator-prd-report/2`。`check-index`、`aggregate` 等读索引的命令遇到 `/1` 打印 `index: <out> was written by an earlier version (excavator-prd-report/1); run again with --fresh` 并退出 1。Phase 0 续跑遇到这一行时告诉用户用 `--fresh` 并停止，不去修索引。
- `--fresh` 可以删除 `/1` 或 `/2` 的产物目录。
- `findings.json` 与报告页数据的 `format` 不变。

### D10 报告页

- 页面数据的功能加 `actors`、`permissionRoles`、`flows`，去掉 `roles`；`body` 是去掉 `openItems` 小节后的正文；表加 `terminology`、`roles`、`openItems`。
- 总览在 `overview.md` 之后依次显示 Terminology、Flow index（由数据生成，链接到功能页 `#/feature/<id>`，不用 PRD 里的标题锚点，以免和片段路由冲突）、Roles、Open items。
- 功能页显示 actors 与 permission roles 两行。

### D11 提交顺序

1. `docs(openspec): propose prd-report-prd-shape`
2. `feat(prd-report): declare flows, actors and open items in each chapter` — `lane-check`、`index-check`（`reference`、章节顺序、格式、跳过目录）、`Next:` 行与测试。
3. `feat(prd-report): assemble the document skeleton` — `aggregate` 的新表与覆盖行、章节拆分、`assemble` 的顺序与流程索引、`summarize`/`reply` 的 `retryable`、`page-data` 的新字段与测试。
4. `feat(excavator-verify): leave the summary out with --no-summary`
5. `feat(prd-report-page): show the document skeleton`
6. `feat(prd-report): write the document skeleton` — `SKILL.md`、契约测试、`README.md`。
7. `docs(openspec): record prd-report-prd-shape acceptance`
8. `docs(openspec): archive prd-report-prd-shape`

每个提交单独是绿的。

## Risks / Trade-offs

- 声明与正文的一致性要靠泳道第二次尝试修；标题写错一个字就失败一次，多花一次泳道。换来的是索引不会和正文对不上。
- 核对改了流程标题时功能会 `failed`：可见，但比原来严。
- 范围外的种子文件让泳道读得更多，花费随调用方数量增长；只加调用方文件，不加它们的依赖链。
- 锚点算法按 GitHub 的规则；别的 Markdown 预览器可能生成不同的锚点，链接在那里不可用，正文不受影响。

## Acceptance oracles

动手前写死。真实语料的路径、名字与输出不进仓库，记录只写代号与数字。

- **O1 门**：每个代码提交在临时克隆（不用 worktree）里跑三件套、`node scripts/check-refs.mjs`、`pnpm run typecheck`、`openspec validate --all --strict`、legacy-literals、CI 模拟重跑（短 TMPDIR、`user.useConfigOnly=true`）。
- **O2 检查**：D2、D3、D8、D9 列出的每种问题行各一个测试，先红后绿；`Next:` 两种行各一个测试；一个全部合格的正例。
- **O3 拼装**：夹具含一个 `reference` 功能、两个流程功能（其中一个有待确认项小节，另一个有两个同名流程标题以产生重复锚点）、一个失败功能：小节顺序与 D4 完全相同；流程索引行数等于 `reference` 功能数加全部 `flows` 数；每个链接的锚点等于另一份独立实现（`github-slugger`，在测试里用；不可用时用手写的含重复与非 ASCII 标题的固定样例）对 `PRD.md` 标题算出的锚点；待确认项小节不在章节里、在 `## Open items` 下原文出现；两次 `assemble` 字节相同。
- **O4 页面（无头 Chrome，`file://`）**：夹具与一份真实产物副本：总览的术语行数等于词表条数，流程索引行数等于数据里的流程数，每个链接打开对应功能页；控制台错误与 CSP 违例为 0。**装置先验**：从页面数据删掉一个流程，探针必须报出。
- **O5 真实冒烟**：对上述 51 文件的成员，以 `claude -p` 跑 `/excavator-prd-report --scope <成员> --fresh`，`--out` 在 scratchpad，钉 `--model` 为 Sonnet、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`。脚本核对：每个功能 `verified`，或 `failed` 且 `attempts` 为 2（没有停在 1 的）；每章正文恰好一个 `##`；有一个 `reference` 功能写权限模型；范围外种子文件数大于 0，且至少一章的证据锚点在范围外；`Actors by feature` 的列与 `Permission roles` 的行不相交；语料 `.excavator/` 运行前后文件清单与修改时间相同。记录花费与耗时。
- **O6 与单篇对照（独立审读）**：一个只拿到两份 PRD 与源码的 Opus 审读者，对单篇流程索引的每一行判断拼装版的流程索引是否有覆盖它的行，并逐项判断骨架清单（术语表、能力地图、流程索引、全局角色与权限、集中的待确认项、核对只在附录）是否具备。**硬性不通过**：单篇的某个流程在拼装版没有对应行，且不是某个 `failed` 功能（`attempts` 为 2）的范围。
