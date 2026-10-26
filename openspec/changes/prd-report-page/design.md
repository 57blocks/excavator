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
- 一致性：用 `aggregate` 的状态规则重算每个功能的状态，与 `index.json` 不同，或 `findings.json` 不存在，或其 `format` 不是当前标识，就抛错，提示先运行 `aggregate`。`page` 不写任何东西。
- 证据路径本来就是相对项目根的；页面里不出现本机绝对路径。

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
