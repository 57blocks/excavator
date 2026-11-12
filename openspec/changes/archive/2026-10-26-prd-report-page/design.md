## Context

- `excavator-prd-report` 的产物目录（`archive/2026-10-26-split-prd-report`）已有页面要的全部内容：`index.json`（功能、状态、失败原因、计数、未分配入口、没有模式的框架）、`overview.md`、`features/<id>.md`（front-matter + 正文，正文含 mermaid 与 `<details>` 证据块）、`findings.json`、`verification/<id>.md`、`tables/*.md`。页面不新增任何模型产物。
- `excavator-view` 已有一套单文件页面的做法：`packages/explorer` 用 vite 构建一个内联全部资源的模板，`skills/excavator-view/page-assembly.mjs` 只替换模板里的两个标记位（CSP 与数据）。本变更沿用这套做法，但做一个独立的模板与页面（用户要求不与 view 的页面混在一起）。
- PR #81 的验收在真实语料上留下了两份完整产物（语料代号 go-multirepo 的两个子项目：5 个功能 52 条 findings、11 个功能），在 scratchpad 里，可作为页面的真实输入。它们的 `format` 是改名前的 `excavator-prd/1`；验收时复制一份并把 `format` 字段改成新标识，记录在案。

## Goals / Non-Goals

**Goals**
- 产物目录里的每个功能、每条 finding 在页面上都有可见的位置，数目与文件相同。
- 页面双击可用，无网络，字节确定。
- 页面像产品：清楚的导航、可读的排版、亮暗两色、窄屏可用。

**Non-Goals**
- 见 proposal 的「不做」。

## Decisions

### D1 为什么写代码（AI-first scope gate）

页面是把十几个文件确定性地打成一个约 4 MB 的单文件，并检查它与 `index.json` 一致；模型做不到字节确定，也不该转写结构化事实。页面里所有散文仍是模型在泳道里写的，脚本只搬运。

### D2 独立模板包 `packages/prd-report-page`

- vite + React 单文件构建，产物 `dist/prd-report-page.html`，带 `<!-- xv:csp -->` 与 `<!-- xv:data -->` 两个标记位；构建后的检查脚本（同 explorer 的 `check-template`）确认目录里只有这一个文件、标记位各一次、开头有打包库的许可清单。
- explorer 里与页面无关的通用构建插件（单文件内联、许可收集、字体内联）可以直接从 `packages/explorer/scripts/` import；模板契约、检查与页面代码属于新包自己。两个页面不共享运行时代码。
- 依赖：`react`、`react-dom`、`react-markdown`、`remark-gfm`（工作区已有同版本）与新增的 `mermaid`、`rehype-raw`、`rehype-sanitize`，版本钉死。

### D3 数据由 `lib/page-data.mjs` 收集，先查一致再写

- 纯函数，输入产物目录与项目根，输出一个对象：`format: "excavator-prd-report-page/1"`；`project`（项目目录名，不含绝对路径）、`sourceRevision`、`language`、`role`、`scope`；`counts`（同 `aggregate` 打印的字段）；`overview`（Markdown）；`features`（按 `chapter` 排序，每个带 id、名称、kind、状态、失败原因、attempts、核对计数、入口、正文 Markdown、核对报告 Markdown；front-matter 由现有 `lib/front-matter.mjs` 解析，正文里去掉；其中的 `roles` 与 `triggers` 作为功能的元数据带上，功能页在正文前显示）；`findings`（`findings.json` 原样）；`tables`（三张表的 Markdown）；`unassigned`；`uncovered`。键顺序固定。
- 一致性：用 `aggregate` 的状态规则重算每个功能的状态与失败原因，任一与 `index.json` 不同，或 `findings.json` 不存在、其 `format` 不是当前标识、内容不是 `aggregate` 现在会写的，就抛错，提示先运行 `aggregate`。`page` 不写任何东西，并先删掉上次运行留下的 `report.html`，使失败时 `reply` 不会报出旧页面。（验收补：原先只比状态，真实产物里失败原因变了而状态仍是 `failed`，页面与 `PRD.md` 附录不一致。）
- 证据路径本来就是相对项目根的；但模型写的核对报告会写出项目根的绝对路径（验收在真实产物里见到）。收集完数据后对全部字符串做一次替换：项目根（`index.json` 记录的与 `--project` 给的，及其真实路径）换成项目目录名。页面里不出现项目根的绝对路径；其它本机路径脚本无从识别，记为残余。

### D4 Markdown 与图

- `react-markdown` + `remark-gfm` + `rehype-raw` + `rehype-sanitize`。净化表以 `rehype-sanitize` 的默认（GitHub）表为底，加上 `details`、`summary` 与 `details` 的 `open` 属性；其余原始 HTML（`script`、事件属性、`iframe`、`style`）被去掉。
- 语言为 `mermaid` 的代码块交给 `mermaid.render`（`startOnLoad: false`、`securityLevel: 'strict'`），图的 id 由功能 id 与块序号确定。渲染抛错时显示源文本与 "Diagram failed to render" 标记。
- 主题跟随 `prefers-color-scheme`，mermaid 主题随之选 `default` 或 `dark`。

### D5 导航

`#` 片段路由：`#/`（总览）、`#/feature/<id>`、`#/findings?class=<c>&feature=<id>&q=<text>`、`#/coverage`。筛选条件放进片段，链接可分享、刷新不丢。左侧栏固定：项目名、总览、Findings、Coverage，然后按 `chapter` 列出全部功能，每项带状态标记与 findings 数。窄屏下侧栏收成顶部菜单。

### D6 视觉

产品级排版：正文最大宽度约 72 字符、标题层级清楚、表格可横向滚动、代码与引文用等宽字体。状态与类别用固定的颜色与文字标记（不只靠颜色）。字体与配色取 explorer 的同一套（Inter、JetBrains Mono，内联），使两个页面看起来出自同一产品。界面文字固定英文。

### D7 写出页面：`prd.mjs page`

- `page <out> --project <root>`：调 D3 取数据，读模板（未构建时报错并提示 `pnpm -r build`，同 view），只替换两个标记位，写 `<out>/report.html`，打印路径。数据经 `jsonForScript` 同样的转义（`<` 写成 unicode 转义）。
- CSP：`default-src 'none'`、`script-src 'unsafe-inline'`、`style-src 'unsafe-inline'`、`img-src data:`、`font-src data:`、`connect-src 'none'`、`base-uri 'none'`、`form-action 'none'`；mermaid 不需要 worker，不放 `worker-src`。
- 不写时间、不写本机路径，同一输入字节相同。

### D8 skill 接线

`SKILL.md` 在 `assemble` 之后加一步 `prd.mjs page`；它失败时把打印的原因原样告诉用户，不让模型自己拼页面或改产物，然后照常运行 `reply`（`PRD.md` 已经写好，回复仍要给）。`reply` 在 PRD 路径之后打印 `Report page: <out>/report.html`；文件不存在时打印 `Report page: not written`，不省略这一行。

### D9 提交顺序

1. `docs(openspec): propose prd-report-page`
2. `feat(prd-report): collect the report page's data` — `lib/page-data.mjs` 与单测（夹具用 `tests/fixtures/prd-report-pipeline/lanes/out`，另造失败功能、缺章节、过期三种夹具）。
3. `feat(prd-report-page): add the report page template` — 新包、构建、模板检查、视图模型的单测（筛选、路由解析、净化表）。
4. `feat(prd-report): write report.html with prd.mjs page` — 命令、CLI 测试、重复生成字节相同的测试、模板未构建的报错测试。
5. `feat(prd-report): run page after assemble and print its path` — `SKILL.md`、`reply.mjs`、契约测试、`README.md`、`docs/deploy.md`。
6. `docs(openspec): record prd-report-page acceptance`
7. `docs(openspec): archive prd-report-page`

每个提交单独是绿的。

## Risks / Trade-offs

- mermaid 使模板增大约 2–3 MB；接受，单文件仍在几 MB 量级。
- mermaid 版本升级可能改变渲染；版本钉死，升级另做。
- 界面固定英文，中文产物的读者会看到英文导航；与 `PRD.md` 的固定英文表一致，多语言另开变更。
- 证据只给 `文件:行` 与引文，不能在页面里跳到源码；要看源码仍用编辑器或 `excavator-view`。

## Acceptance oracles

动手前写死。真实语料的路径、名字与输出不进仓库，记录只写代号与数字。

- **O1 门**：每个代码提交在临时克隆（不用 worktree）里跑三件套（`pnpm -r build` 会构建新模板）、`node scripts/check-refs.mjs`、`pnpm run typecheck`、`openspec validate --all --strict`、legacy-literals、CI 模拟重跑（短 TMPDIR、`user.useConfigOnly=true`）。
- **O2 字节确定**：同一产物目录 `page` 两次，`cmp` 相同；模板构建两次，`cmp` 相同（不同则记录差异来源）。
- **O3 无网络**：`report.html` 的 CSP 含 `connect-src 'none'`；没有 `<script src`、`<link href`、CSS `url(http`、`@import`；列出全部 `http://`、`https://` 出现处并逐个说明（如 SVG 命名空间、许可文本），比内容不比计数。
- **O4 内容齐全（无头 Chrome，`file://`）**：对三份输入——夹具产物、两份真实产物的副本——用 DevTools 协议读 DOM，断言：总览与侧栏里每个 `index.json` 的功能恰好一次且状态一致；每个功能页的 findings 数等于 `findings.json` 中该功能的条数；findings 页总数等于 `findings.json` 条数，选 `product` 后等于该类条数；渲染出的 mermaid SVG 数加失败标记数等于 mermaid 代码块数；控制台错误与 CSP 违例为 0。**装置先验**：在副本里删掉一条 finding 的页面数据、写坏一个 mermaid 块，探针必须分别报出来。
- **O5 过期**：`aggregate` 之后改动一个功能的章节使状态变化，`page` 退出非零且不写 `report.html`。
- **O6 净化**：夹具章节里放 `<script>`、`<img onerror>`、`<iframe>` 与 `<details>`，页面里前三者无效（探针在页面上看不到它们设的标记），`<details>` 可展开。
- **O7 截图**：总览、一个功能页、findings 页，桌面宽度与 375 px 各一张，给用户看排版。真实产物的截图只留在 scratchpad，不进仓库、PR 与提交信息。
- **O8 真实接线冒烟**：在一份真实产物副本上（全部功能已 `verified`）以 `claude -p` 跑 `/excavator-prd-report`，钉 `--model` 为 Sonnet、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`：0 次泳道派发，写出 `report.html`，最后回复的第二行是报告页路径；语料 `.excavator/` 运行前后文件清单与修改时间相同。记录花费与耗时。若语料当前快照与副本的 `sourceRevision` 不同（skill 会拒绝续跑），O8 记为「未跑」并写明原因，不改 `sourceRevision` 凑通过。

## 验收记录

2026-10-26，验收代理（Opus）执行；只检查、不修。所有克隆、产物副本、页面、截图与日志都在会话 scratchpad，不进仓库。输入代号：**夹具**（`tests/fixtures/prd-report-pipeline/lanes/out` 的副本，2 个功能）、**真实副本 A**（go-multirepo，5 个功能，全部 verified，52 条 findings）、**真实副本 B**（go-multirepo，11 个功能，3 个 failed，100 条 findings）。共两轮：第一轮在 b960453f 上，第二轮在三个修复提交之后的 9094fbe9 上重跑 O1–O7；下面各节写的是第二轮的结果，第一轮的未满足项与修复提交在「第一轮发现与修复」一节各留一行。

**两份真实副本的处理。** 复制后只改了三个 `format` 字段，别的字节未动：`index.json` 的 `excavator-prd/1` → `excavator-prd-report/1`；`findings.json` 的 `excavator-prd-findings/1` → `excavator-prd-report-findings/1`；`entrypoints.json` 的 `excavator-prd-entrypoints/1` → `excavator-prd-report-entrypoints/1`。`--project` 传语料根（`page-data` 以 `--project` 的 realpath 与 `index.json.projectRoot` 比对，scope 只是记录字段）。另在独立副本上各跑了一次 `aggregate` 做对照：A 无任何文件变化；B 的 `index.json` 只有 F6 的失败原因从 3 条变成 1 条（`findings/F6.json` 补写了 `line`，`findings.json` 不变）。所以 A 原样即可 `page`；B 原样在 9094fbe9 上被拒（见 O4），O2–O7 中的 B 用的是先 `aggregate` 的那份副本。

**模板大小。** 9094fbe9 的 `prd-report-page.html` 6,179,801 字节（约 5.9 MiB），比 D1 估的「约 4 MB」大约 55%；三份 `report.html` 为 6,184,830（夹具）、6,376,949（A）、6,619,061（B，`aggregate` 后）字节。

### 第一轮发现与修复

- B 原样时页面上 F6 的失败原因（1 条）与 `index.json`、`PRD.md`（3 条）不同：一致性检查只比状态，失败原因取自重算值。8d6524a1 把失败原因也纳入一致性检查，第二轮 B 原样被拒（O4）。
- B 的页面含 5 处本机绝对路径，来自核对报告里模型写的 "Project source: `<绝对路径>`"。9094fbe9 把项目根（及其 realpath）换成项目目录名，第二轮 0 处（O3）。
- 375 px 下 B 的 findings 页与 F9 功能页横向溢出（`scrollWidth` 536），由一个不可断行的长标识符撑开；另有功能页两列不齐、筛选条控件高度不一、暗色小标签对比度偏低。d5906537 改样式，第二轮四项都不再出现（O7）。

### O1 门（每个代码提交一个 `git clone --no-hardlinks` 克隆，`checkout --detach`，逐个串行）

每个克隆都 `git config --local user.useConfigOnly true` 并去掉本地 `user.name`/`user.email`；CI 模拟重跑另设 `TMPDIR=<scratchpad 下的短目录>`（scratchpad 本身路径长 139 字符，做不到真正的短路径，照记）和 `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true`。验收期间机器负载 35–63（另有会话在跑测试），没有出现已知的 `check-refs.test.mjs` 超时，无需单独重跑。

| 提交 | install / `pnpm -r build` | `pnpm test` | check-refs | typecheck | `openspec validate --all --strict` | legacy-literals | CI 模拟 `pnpm test` | 结论 |
|---|---|---|---|---|---|---|---|---|
| c846cad8 | 0 / 0 | 229 文件，5127 通过、4 跳过 | OK | 0 | 52 通过 | 1 文件通过 | 5127 通过、4 跳过 | 满足 |
| 538b73e6 | 0 / 0（模板 check-template：6,179,258 字节） | 234 文件，5168 通过、4 跳过 | OK | 0 | 通过 | 通过 | 5168 通过、4 跳过 | 满足 |
| 320e80d4 | 0 / 0 | 5181 通过、4 跳过 | OK | 0 | 通过 | 通过 | 5181 通过、4 跳过 | 满足 |
| b960453f | 0 / 0 | 235 文件，5189 通过、4 跳过 | OK | 0 | 通过 | 通过 | 5189 通过、4 跳过 | 满足 |
| d5906537 | 0 / 0（模板 6,179,801 字节） | 235 文件，5189 通过、4 跳过 | OK | 0 | 52 通过 | 1 文件通过 | 5189 通过、4 跳过 | 满足 |
| 8d6524a1 | 0 / 0 | 235 文件，5191 通过、4 跳过 | OK | 0 | 52 通过 | 1 文件通过 | 5191 通过、4 跳过 | 满足 |
| 9094fbe9 | 0 / 0 | 235 文件，5196 通过、4 跳过 | OK | 0 | 52 通过 | 1 文件通过 | 5196 通过、4 跳过 | 满足 |

### explorer 模板不变

`main`（6d6ddee7）与 9094fbe9 各在自己的克隆里 `pnpm -r build`：`packages/explorer/dist/explorer.html`（3,435,620 字节）与 `packages/explorer/dist-node/schema.cjs`（209,346 字节）两两 `cmp` 字节相同（第一轮 b960453f 也相同）。**满足。**

### O2 字节确定

- 同一产物目录 `page` 两次，`cmp` 相同：夹具、A、B 三份都相同。
- 模板在 9094fbe9 的克隆里构建两次，`cmp` 相同（6,179,801 字节）；d5906537、8d6524a1、9094fbe9 三个不同路径的克隆构建出的模板也两两字节相同（后两个提交不动模板包），说明模板不含克隆路径。
- **满足。**

### O3 无网络

- 三份页面的 CSP 都是 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'`，各一处。
- `<script src` 0、`<link href` 0、CSS `url(http` 0。`@import` 1 处：打包的 CSS 解析库里的字符串常量（`"@import"` 与 `"@media"` 等并列的词表），不是样式规则。`<iframe` 1 处：mermaid 在 `securityLevel: 'sandbox'` 下拼 iframe 的模板字符串，页面用 `strict`，不会走到。
- 全部 `http(s)://`：模板自带 59 个不同 URL，逐个看过，分五类，都是字符串，没有一处是加载：W3C 命名空间与 XML Schema 类型 URI（`www.w3.org`）；库的报错/文档链接（React 错误解码、chevrotain、langium、mermaid、marked、react-markdown changelog）；许可证注释（babel、jQuery、MIT、tailwind、`opensource.org`、`tldrlegal.com` 等）；ELK/EMF 的 ecore 命名空间（`eclipse.org`）；parse5 的 DTD 公共标识（`ibm.com`）以及 `"http://"` 自动链接前缀。真实副本 A 的数据另有 5 个 URL，来自模型写的章节表格与一条 finding 的引文（服务的条款/许可/主机地址），在页面上是 Markdown 自动链接，不会被自动请求。B 的数据没有额外 URL。第二轮的 URL 集合与第一轮相同。
- 无头 Chrome 打开三份页面并走遍所有页时，`Network.requestWillBeSent` 中除 `file:`、`data:` 外的请求为 0。
- 本机绝对路径：三份页面与模板里语料根 0 处，`/Users/`、`/private/`、`/var/folders`、`/tmp/`、`/home/` 各 0 处。B 的 5 处 "Project source" 现为 `<项目目录名>/<成员仓库>`，另 3 处原本就是相对路径。
- 替换边界（在夹具核对报告末尾追加几种写法后 `page`）：项目根本身与 `<根>/src/...` 换成目录名；`<根>-two/x`、`<根>.bak` 这类同前缀的兄弟路径不换（正确，不误伤）；项目根位于 `/private/tmp` 下时，它的非 realpath 写法 `/tmp/...` 也不换。后两种仍是本机绝对路径，属于 D3 已注明的残余风险（项目根以外的本机路径不处理），本轮真实副本里没有出现。
- **满足。**

### O4 内容齐全（无头 Chrome，`file://`，DevTools 协议）

探针按 `packages/prd-report-page/src/` 的标记写（`tr[data-feature-row]`、`#sidebar a.nav-link .nav-id`、`[data-status]`、`[data-finding]`/`[data-class]`/`.finding-statement`/`.evidence .loc`/`pre code`、`[data-findings-list]`、`[data-result-count]`、`[data-class-filter=product]`、`[data-diagram=done|failed|pending]`、`[data-failure]`、`[data-chapter=none|body]`）。期望值一律从产物文件读（`index.json`、`findings.json`、`features/*.md` 与 `verification/*.md` 里的 mermaid 围栏），不读页面的数据块；空匹配算失败。逐条比内容：功能 id 与状态（属性与文字）、失败原因全文、每条 finding 的 id 与顺序、类别、陈述全文、每条证据的 `文件:行` 与引文全文、`anchor-checked` 标签。Product 筛选用真实鼠标事件点按钮。DOM 连续 3 次轮询不变且没有 `pending` 的图才算稳定。控制台错误取 `Runtime.consoleAPICalled`(error)、`Runtime.exceptionThrown`、`Log.entryAdded`(error)；CSP 违例取 `Audits` 的 CSP issue 与页面内 `securitypolicyviolation` 事件。

**装置先验**（在 A 的页面副本上改页面数据，产物文件不变；两轮都做，结果相同），每一项探针都报出了，且报的是被改的那一条：
- 删掉 finding F1-3：侧栏 F1 计数 13≠14、Findings 总数 51≠52、F1 页与 findings 页缺 `F1-3`、Product 筛选 15≠16。
- 写坏 F5 的一个 mermaid 块：失败标记多出一处，位置为 F5 页（基线只有 F2、F3 两处）。
- 把 F1 一个 mermaid 块改成 `text` 代码块：F1 页 SVG 1 + 失败 0 ≠ 围栏 2。
- 改 F5-9 的陈述（条数不变）：F5 页与 findings 页都报 F5-9 内容不符。
- 改 F1 的状态：总览表、侧栏、F1 页三处报状态不符。
- 页面注入外部图片：报 CSP 违例（`img-src`）、控制台错误与一条 `https:` 请求。
- 页面注入 `console.error`：报控制台错误。

**结果（9094fbe9 的模板）：**

| 输入 | 断言数 | 不符 | 功能（总览/侧栏各一次、状态一致） | findings 总数 / product | mermaid（SVG + 失败标记 = 围栏） | 控制台错误 / CSP 违例 |
|---|---|---|---|---|---|---|
| 夹具 | 34 | 0 | 2/2 | 2 / 1 | 2 + 0 = 2 | 0 / 0 |
| 真实副本 A | 52 | 0 | 5/5 | 52 / 16 | 8 + 2 = 10 | 0 / 0 |
| 真实副本 B（另一副本，先 `aggregate`） | 94 | 0 | 11/11 | 100 / 52 | 34 + 2 = 36 | 0 / 0 |

- **真实副本 B 原样**（只改 format 字段，未 `aggregate`）：`page` 退出 2，stderr 为 `prd.mjs page: the run is not up to date with its files: F6's failure reasons in index.json differ from what its files give; run \`prd.mjs aggregate <out> --project <root>\` first`；运行前放进去的上一次 `report.html` 被删掉，目录里其余文件前后相同。即页面不会再显示与 `index.json` 不同的失败原因。
- 每个功能页的 findings 条数与 id 都等于 `findings.json` 中该功能的条目；failed 的 F4、F6、F7 显示 0 条与 "No findings" 提示。
- B 的三个 failed 功能都显示 `failed`、`Failed at step check-lane` 与原因列表（与 `index.json` 逐条相同），并显示 "This feature has no chapter: it failed"；覆盖页的失败表列出 F4、F6、F7。
- mermaid 失败标记共 4 处（A 的 F2、F3，B 的 F5、F10），都是 `sequenceDiagram` 的 `Parse error`：消息文字里含 `;`（包括 `&lt;` 这类实体自带的分号），在 mermaid 里是语句分隔符，属于模型写的图本身无效，页面按 D4 显示源文本与 "Diagram failed to render"，计入等式。

**满足。**

### O5 过期

- 夹具副本：`aggregate`、`assemble`、`page` 之后删掉 `verification/F1.txt`（verified → checked）：`page` 退出 2，stderr 为 `the run is not up to date with its files: F1 is verified in index.json but its files give checked; run \`prd.mjs aggregate <out> --project <root>\` first`。
- 真实副本 A：把 F4 章节里一个锚点的行号改到文件末尾之后（verified → failed）：`page` 退出 2，原因同时列出状态不符与 `findings.json does not hold the current findings of F4`。同一过期目录再跑一次：仍退出 2。
- 两种情况运行前都已有上一次的 `report.html`，失败后都不存在；目录里其余文件的 sha256 前后相同；没有残留 `.tmp-` 文件。`reply` 第二行在这种情况下打印 `Report page: not written`；对写成页面的目录打印 `Report page: <out>/report.html`。
- **满足。**

### O6 净化

自建夹具副本：在 F1 章节末尾加 `<script>`（设 `window.__xvPwnScript` 并改标题）、`<img src="x" onerror=…>`（设 `__xvPwnImg`）、`<iframe src="data:…">`（含设 `__xvPwnIframe` 的脚本与 `onload`）、`<a href="javascript:…">` 与 `<details><summary>Hostile details</summary>…</details>`，然后 `aggregate`、`assemble`、`page`。

- 页面上（42 项断言全过）：章节内 `script` 0、全页 `iframe` 0、`main` 内事件属性 0、三个标记都未设置、标题未被改；`img` 被页面的图片组件显示成 `[image]`；`javascript:` 链接的 `href` 被去掉。
- `<details>` 保留；初始折叠，鼠标点 summary 后 `open` 为 true，内容高度 26 px。
- 控制台错误 0，CSP 违例 0。
- 装置先验（第一轮）：把同样的 `<img onerror>`、`<iframe>`、`<script>` 直接写进页面（绕过 Markdown），探针报出 iframe 1、`__xvPwnScript` 与 `__xvPwnImg` 被设置、CSP 违例与控制台错误。
- **满足。**

### O7 截图

夹具与真实副本 B 各截总览、功能页、findings 页，1440 px 与 375 px（移动端模拟）各一张，另加整页、375 px 菜单展开与 1440 px 暗色各一组；只留在 scratchpad。

`document.documentElement.scrollWidth`：375 px 下 B 的总览、findings、F9、F1、F6、覆盖页与夹具的总览、findings、F1 都是 375；1440 px 下都是 1440。第一轮的四项问题：

1. 375 px 横向溢出：**已消失**（第一轮 B 的 findings 页与 F9 页为 536）。
2. 功能页两列不齐：**已消失**。1440 px 下量得 B 的 F9、F1 与夹具 F1 的元数据、章节、图、Evidence 块、findings 列表与卡片、核对报告左右边缘都是同一组值（第一轮图与 Evidence 块的右边缘比其他内容短 136 px）。
3. 筛选条控件高度不一：**已消失**。Class 分段按钮组与 Feature 下拉框都是 36 px 高、顶边对齐，筛选标签行高统一为 16 px（第一轮下拉框 33 px，顶边差 2 px）。
4. 暗色小标签对比度偏低：**已消失**。暗色下功能页 `.chip` 的文字对比度 14.6:1（第一轮 7.7:1，看图时发灰），徽标 7.7–10.7:1。

仍照记（未要求修）：

5. 1440 px 侧栏：功能名较长时折成 4–5 行，状态徽标挤在右侧，可读但拥挤。
6. 375 px 下 mermaid 图整体缩放，图内文字约 9 px，偏小。
7. 新出现（轻微）：功能页内容区收窄到 800 px 后，1440 px 下入口行的长文件路径与 `route` 标签占满一行，`gin` 标签被挤到下一行单独成行，每个入口变成两行。

没有看到：侧栏不满高、标题重复、文字被裁切。**截图已交付；第一轮的可复现排版缺陷（1）已修复。**

### O8 真实接线冒烟

- 第一轮：用 skill 的方式（`skills/excavator/consumer-freshness.mjs <语料根>`）算出的当前 `sourceRevision` 与真实副本 A 的相同，满足运行条件；以 `claude -p "/excavator:excavator-prd-report <语料根> --scope <A 的 scope> --out <A 的新副本，已删 report.html>"`、`--model claude-sonnet-5`、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`、`--max-budget-usd 5` 运行，会话一开始就返回 `Failed to authenticate: OAuth session expired and could not be refreshed`（花费 $0，墙钟 3 秒）；语料 `.excavator/` 前后不变。
- 第二轮：运行前单独查一次 `claude auth status`：`loggedIn: false`、`authMethod: none`。没有尝试登录。
- 第三轮（用户登录后）运行前核对：`claude auth status` 为 `loggedIn: true`（claude.ai）；用 skill 的方式（9094fbe9 克隆里的 `skills/excavator/consumer-freshness.mjs <语料根>`）算出的当前 `sourceRevision` 为 `fresh`，与真实副本 A 的 `sourceRevision` 相同，满足运行条件。没有其他 `claude -p` 并行。
- 运行：在真实副本 A 的新副本上（删掉 `report.html`，其余字节与第二轮验收用的 A 相同），`claude -p "/excavator:excavator-prd-report <语料根> --scope <A 的 scope> --out <该副本>"`，`--model claude-sonnet-5`、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`、`--max-budget-usd 5`、`--plugin-dir` 为 9094fbe9 的已构建克隆、`dontAsk` + 沙箱 Bash（只许写输出目录）+ 只放行 MCP 读工具。
- 结果：退出 0，`subtype: success`、`is_error: false`，stderr 为空。9 轮，工具调用只有 8 次 Bash，**泳道派发（Agent）0 次**，MCP 调用 0 次。模型按 skill 依次跑了 `check-index`（18 个候选全部分配，5 个功能）、`aggregate`、`assemble`、`page`、`reply`。
- 最后回复（路径以占位写出）：
  ```
  <out>/PRD.md
  Report page: <out>/report.html
  5/5 features written, 0 failed
  10 diagrams
  16 product, 36 technical findings, anchors checked
  Statements: 126 verified, 4 contradicted, 1 misattributed, 0 unverifiable; open items: 5 resolved right, 2 resolved wrong, 2 still open; cross-section conflicts: 0, not checked: 0
  ```
  第二行是报告页路径。
- `report.html` 写出，6,376,949 字节，与第二轮 O2 里对同一份 A 直接运行 `page` 得到的页面字节相同；输出目录其余文件与运行前相同（`aggregate`、`assemble` 没有改动任何文件）。
- 语料 `.excavator/`：运行前后文件清单（1,114 项）、修改时间与内容都相同，0 个文件新于开始标记。
- 花费 $0.47（`total_cost_usd` 0.4695，只用了 `claude-sonnet-5`），墙钟 67 秒（`duration_ms` 62,966）。
- **满足。**（前两轮因无头 CLI 未登录未跑，第三轮补上。）
