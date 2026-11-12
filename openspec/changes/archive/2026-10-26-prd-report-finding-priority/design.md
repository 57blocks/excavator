## Context

- `excavator-prd-report`（规格 `prd-report`）的泳道为每个功能写 `findings/<id>.json`，`aggregate` 汇总成 `findings.json`，报告页（`prd-report-page`）展示它们。规格目前要求 findings MUST NOT 带严重度：泳道只陈述缺陷。
- 一次真实运行（多仓库语料的一个 51 文件子项目，5 个功能）产出 42 条 findings；更大的子项目会有几百条。用户要按 P0、P1 排序。
- `aggregate` 已拆出纯函数 `computeAggregate`，`page` 用它比对磁盘上的全部汇总产物（`archive/2026-10-26-prd-report-page`）。新增的定级必须走同一条路：由 `computeAggregate` 算出，`page` 自然比对。

## Goals / Non-Goals

**Goals**
- 每条 finding 有 `P0`、`P1`、`P2` 之一，或明确的「未定级」，不静默缺失。
- 定级按一份写死的判据，由独立子代理做，理由可核对：说满足了哪条判据、影响到谁。
- 排序与计数由脚本做，模型不排序、不相加。
- 旧产物目录用同一命令再跑一次即可补上定级，不重写章节。

**Non-Goals**
- 见 proposal 的「不做」。

## Decisions

### D1 为什么写代码（AI-first scope gate）

定级本身是判断，交给模型；但「每条 finding 恰好定一次级」「级别只取三个值」「排序与按级别计数」是全表事实与结构检查，模型做不可靠（会漏条、相加出错），所以由脚本做：`check-priorities` 检查，`aggregate` 合并、排序、计数。分批也由脚本算，模型不数 findings 条数。

### D2 由独立的排序子代理定级，泳道仍不写严重度

- 泳道写 findings 时看的是自己功能的代码，容易把本功能的问题评得重；排序子代理只拿到 findings 与证据，按同一判据给所有功能定级，尺度一致。
- 泳道提示词里「Give no severity and no confidence」保持不变。
- 排序在全部章节核对之后、`overview.md` 之前做：此时 findings 已过 `check-lane`，`aggregate` 已把每段引文的行号写回 `findings/<id>.json`。

### D3 判据（写进 SKILL.md，原样传给排序子代理）

```text
- P0 — the defect lets someone do what they are not allowed to (pass an authentication or permission check meant to stop them, read or change another user's data, see a secret), loses or corrupts stored data, produces a wrong amount of money, or makes a main flow of the feature fail for every user.
- P1 — the defect gives users a wrong, inconsistent or missing result in a flow they use, hides a failure from users or operators (an error swallowed, success reported after a failure), or fails on ordinary input.
- P2 — any other defect: a value fixed in code, dead or duplicated code, inconsistent naming, gaps in logging or documentation.
Give the highest level whose condition the evidence shows. When the evidence does not show it (for example, it is not evident that an outsider can reach the endpoint), give the lower level and say in the reason what is not evident.
```

理由一句话，用 `$LANGUAGE`，说满足了哪条判据、影响到谁；不写修法（与 findings 同一份建议性措辞表）。

### D4 文件与检查：`priorities/<id>.json` 与 `prd.mjs check-priorities`

- 形状：`{"priorities": [{"id": "<finding id>", "priority": "P0" | "P1" | "P2", "reason": "<one sentence>"}]}`，键恰好这三个。
- 新模块（如 `lib/priorities.mjs`）导出纯函数：给定一个功能的 findings 与定级文件内容，返回问题清单。问题包括：文件缺失或不能解析、形状不对、某条 finding 没有定级、同一 id 出现两次、多出不属于该功能的 id、级别不是三个值之一、理由为空、理由超过 300 字符、理由含建议性措辞（复用 `lane-check.mjs` 的 `adviceWord`）。
- `check-priorities <out> --project <root>`：对每个 `checked` 或 `verified` 的功能运行上面的函数。每个功能打印一行：`F1: ranked`，或 `F3: <问题>`（多个问题各一行）。然后打印需要排序的功能的分批：`batch 1: F3 F4`，按章节顺序装批，每批 findings 合计不超过 120 条；单个功能超过 120 条时自成一批；没有 findings 的功能不需要定级文件，记为 ranked。末行打印 `Rank: <n> features ranked, <m> unranked`。全部 ranked 时退出 0，否则退出 1。它不写任何文件，不改 `index.json`。
- 未定级不是状态：定级不影响功能的 `status`，`PRD.md` 照常拼装。

### D5 `aggregate` 合并、排序与计数

- `findingsOf`：对每个功能，定级文件通过 D4 的检查时，给每条 finding 加 `priority` 与 `priorityReason`；否则两者都是 `null`。
- 排序：级别（P0、P1、P2、未定级），然后功能在 `index.json` 里的顺序，然后 finding id 的序号。全部未定级时，顺序与改动之前相同（功能顺序、再序号）。
- 每个功能的 `counts.findings` 加 `priority: {P0, P1, P2, unranked}`；`summarize` 打印的 `findings` 加上这四个合计。四者之和 SHALL 等于该功能（与全体）的 findings 条数，脚本自查，不等则 `aggregate` 报错退出 1。
- `index-check.mjs` 的 schema：`priority` 计数可缺省（旧 `index.json` 没有，续跑时 `check-index` 照常通过），`aggregate` 总是写上。
- `findings.json` 的 `format` 不变；新增两个字段。旧产物目录的 `findings.json` 没有它们，`page` 比对时报过期，要求先跑 `aggregate`（skill 的流程本来就先跑）。

### D6 skill 流程

- Phase 3 在逐章核对（step 2–3）之后加一步「Rank the findings」：
  1. 运行 `aggregate`，再运行 `check-priorities`。
  2. 退出 1 时，为它打印的每个 `batch` 派一个排序子代理，前台，一条消息最多 `--concurrency` 个；提示词是 SKILL.md 里写死的那段，含 D3 判据、该批功能的 id 与名称、`findings/<id>.json` 的路径。子代理只读这些文件与证据所在的源码文件（只读，可在锚点附近读几十行），只写这批功能的 `priorities/<id>.json`，回复一行。
  3. 再运行 `check-priorities`。仍有问题的功能：删掉它的定级文件，单独再派一次，附上它的问题行；再检查。第二次仍不过就删掉文件，这些 findings 记为未定级，并告诉用户 `Rank <id>: unranked`。
  4. 最后再运行一次 `check-priorities`，把它的末行 `Rank: <n> features ranked, <m> unranked` 原样告诉用户（译成 `$LANGUAGE`，数字不变）。数字由脚本打印，模型不数。
- 续跑：已有合格定级文件的功能不再排；旧产物目录（没有 `priorities/`）再跑一次只补这一步与之后的步骤。
- 主模型 MUST NOT 自己写或改 `priorities/<id>.json`，只能由排序子代理写；与泳道文件的规则相同。

### D7 回复

findings 行改为：`<product> product, <technical> technical findings, anchors checked: <P0> P0, <P1> P1, <P2> P2, <unranked> unranked`。数字来自 `aggregate` 记录的字段。

### D8 报告页

- `types.ts`：`Finding` 加 `priority: 'P0' | 'P1' | 'P2' | null` 与 `priorityReason: string | null`；计数加 `priority`。
- finding 卡片：级别标记在类别标记旁，文字 `P0`/`P1`/`P2`/`Unranked`，P0 红、P1 琥珀、P2 灰、未定级描边；理由显示在陈述下方，前缀 `Why this level:`。
- findings 页：默认按数据里的顺序（已按级别排好）；新增级别筛选（All、P0、P1、P2、Unranked），片段路由加 `priority=`，与 `class`、`feature`、`q` 组合；显示的条数等于筛选后的条数。
- 总览：findings 计数卡加各级别条数，点击跳到对应筛选。
- 功能页：findings 按数据顺序，即按级别。
- 界面文字固定英文；理由按产物原样显示。

### D9 提交顺序

1. `docs(openspec): propose prd-report-finding-priority`
2. `feat(prd-report): check finding priorities and merge them in aggregate` — `lib/priorities.mjs`、`check-priorities` 命令、`aggregate`/`computeAggregate` 的合并排序计数、`index-check` schema、`page-data` 带上新字段，与单测。
3. `feat(prd-report-page): show and filter findings by priority` — 页面与单测。
4. `feat(prd-report): rank findings after verification` — `SKILL.md`、`reply.mjs`、契约测试、`README.md`。
5. `docs(openspec): record prd-report-finding-priority acceptance`
6. `docs(openspec): archive prd-report-finding-priority`

每个提交单独是绿的。

## Risks / Trade-offs

- 模型定级会有方差：同一条 finding 两次运行可能差一级。判据写死、理由要点名判据，能核对但不能消除；验收的独立审读量的是判据符合度，不是唯一正确答案。
- 排序多一次子代理派发，花费随 findings 条数线性增长；按 120 条一批估计，每批一次派发，远小于泳道的花费。
- 证据不足时取低一级，会把一部分真正严重的问题压到 P1；理由里写明「什么不明显」，读者能看到。

## Acceptance oracles

动手前写死。真实语料的路径、名字与输出不进仓库，记录只写代号与数字。

- **O1 门**：每个代码提交在临时克隆（不用 worktree）里跑三件套、`node scripts/check-refs.mjs`、`pnpm run typecheck`、`openspec validate --all --strict`、legacy-literals、CI 模拟重跑（短 TMPDIR、`user.useConfigOnly=true`）。
- **O2 无定级时不变**：夹具产物在改动前后各跑一次 `aggregate`：`findings.json` 的条目顺序相同，每条只多 `priority: null` 与 `priorityReason: null`；`tables/*.md` 字节相同；`index.json` 只多每个功能的 `priority` 计数。
- **O3 检查**：D4 列出的每种问题各一个测试，先红后绿；加一个全部合格的正例。
- **O4 排序与守恒**：混合级别的夹具：`findings.json` 的顺序符合 D5 的三重键；各功能与全体的四个级别计数之和等于 findings 条数；人为让计数不守恒（改测试替身）时 `aggregate` 退出 1。
- **O5 页面（无头 Chrome，`file://`）**：夹具（带定级）与一份真实产物副本（带定级）：每条 finding 的级别标记与数据相同；每个级别筛选后显示的条数等于 `findings.json` 该级别的条数；总览各级别计数相同；控制台错误与 CSP 违例为 0。**装置先验**：改掉页面数据里一条 finding 的级别，探针必须报出。
- **O6 真实冒烟**：把用户刚跑完的那个子项目产物复制到 scratchpad（不动原目录），以 `claude -p` 跑 `/excavator-prd-report`，`--out` 指向副本，钉 `--model` 为 Sonnet、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`：泳道派发次数等于副本里 `failed` 且 `attempts` 小于 2 的功能数（这是续跑的规定行为，副本按原样使用，不改它的状态；运行前写下这个数），排序子代理派发次数等于 `check-priorities` 打印的批数，最终 `check-priorities` 退出 0，全部 findings 有级别，回复的 findings 行四个级别之和等于 findings 条数，写出 `report.html`；语料 `.excavator/` 运行前后文件清单与修改时间相同。记录花费与耗时。若源码快照与副本的 `sourceRevision` 不同，记为「未跑」并写明原因。
- **O7 判据符合度（独立审读）**：一个不知道排序子代理结果之外任何上下文的 Opus 审读者，对 O6 的结果审读全部 P0 与按级别、类别分层的抽样（每级至少 5 条，不足则全部）：读 finding、证据与源码，判断理由点名的判据是否被证据支持，以及有没有更高一级的判据被证据支持。记录一致率与分歧逐条；**硬性不通过**：任何一条被审读者以证据判为满足 P0 判据却被定为 P2（差两级）。

## 验收记录

2026-10-26，验收代理（Opus）执行；只检查、不修。全部在 d8a9fa8e 的已构建克隆上做：O2–O5 的测试、变异与页面在它的一份副本里（变异逐个文件用 `git checkout -- <文件>` 还原，结束时副本与克隆都无未提交改动），O6 以克隆本身作 `--plugin-dir`。克隆、产物副本、页面、探针、运行输出都在会话 scratchpad，不进仓库。输入代号：**夹具**（`tests/fixtures/prd-report-pipeline/lanes` 用测试辅助函数加工的副本，见 O5）、**真实副本 A**（多仓库语料一个子项目的上一次产物的副本，5 个功能，运行前 F2 为 `failed`、`attempts` 1，其余 4 个 `verified`，`findings.json` 42 条，没有 `priorities/`）。

### O1 门

由门代理在 d8a9fa8e 的临时克隆上跑过，本次没有重跑。其日志：check-refs OK、typecheck 0、`openspec validate --all --strict` 52 通过、legacy-literals 6 通过、CI 模拟 238 文件 5282 通过、4 跳过。

### O2 无定级时不变

- 单测：`aggregate-priority.test.mjs` 的 O2 组（5 条，钉 5a63f6bc 的 `aggregate` 输出摘要）通过。
- 独立对照：从 5a63f6bc 取出 `skills/`（`git archive`），与 d8a9fa8e 各对一份新副本跑 `aggregate`，输入为夹具（2 个功能，2 条 findings）与真实副本 A（42 条）：
  - `findings.json` 条目数与顺序相同（2/2、42/42），每条只多 `priority: null` 与 `priorityReason: null`，其余字段逐条相同；
  - `tables/*.md` 三个文件字节相同；`findings/<id>.json` 字节相同；
  - `index.json` 去掉每个功能的 `counts.findings.priority` 后相同（夹具的 `projectRoot` 不同，是两份副本各自的路径）；新增计数全部为 `unranked`，各功能之和等于 findings 条数（真实副本 A 的 failed 功能 F2 按 12 条计为 unranked）；
  - 打印的 JSON 只多 `findings.priority`（夹具 `unranked` 2、真实副本 A `unranked` 42）与各自不同的 `prdPath`。
- 变异：把 `findingsOf` 里未定级的 `priorityReason` 从 `null` 改成 `''`，O2 的「只多两个 null 字段」与 O4 的「不过检查的功能记为 null」两条测试变红；还原后绿。
- **满足。**

### O3 检查

- `priorities.test.mjs` 32 条通过。D4 的每种问题各有测试：文件缺失、不能解析、形状不对（顶层不是 `{priorities: [...]}`、多余顶层键、条目缺键或类型不对、条目多余键）、某条 finding 没有定级、同一 id 出现两次、多出不属于该功能的 id、级别不是三个值之一、理由为空（含全空白）、理由超过 300 字符（恰好 300 通过）、理由含英文与中文建议性措辞；正例 2 条（全部合格；没有 findings 的功能不需要文件）。`check-priorities` 命令另有 10 条（每功能一行、分批、120 条上限、单功能超限自成一批、只批未定级的、不写文件、拒绝别的项目）。
- 变异：去掉「同一 id 出现两次」的检查，`reports an id that appears twice` 变红（1/32）；还原后绿。
- **满足。**

### O4 排序与守恒

- `aggregate-priority.test.mjs` 的 O4 组 8 条、`aggregate-priority-conservation.test.mjs` 3 条通过。
- 变异一：把守恒自查的 `if (got !== expected)` 改成 `if (false)`，替身让计数差 +1 与 -1 的两条测试都变红（应退出 1 而没有）；还原后绿。
- 变异二：去掉排序第二键（功能在 `index.json` 里的位置），3 条排序测试变红；还原后绿。
- 回复与契约测试：`reply.test.mjs` 10 条、`test_prd_report_skill_contract.test.mjs` 50 条通过。SKILL.md 里的判据与本文 D3 的判据逐行 `diff` 相同。
- **满足。**

### O5 页面（无头 Chrome，`file://`，DevTools 协议）

探针按 `packages/prd-report-page/src/` 的标记写（`[data-finding]` 的 `data-priority`、卡片头部级别徽标的 `data-priority` 与文字、`[data-priority-reason]`、`[data-findings-list=all|feature]`、`[data-result-count]`、`[data-priority-filter]` 的 `aria-pressed`、总览 `[data-level-card]` 的数字与链接）。期望值一律从 `findings.json` 读，不读页面数据块；逐条比 id 与顺序、级别属性、徽标文字（`P0`/`P1`/`P2`/`Unranked`）、理由全文（`Why this level: ` 加 `priorityReason`，null 时不应有理由）。每个级别用片段路由 `#/findings?priority=<级别>` 打开，另用真实鼠标事件点一次 P0 按钮；每个功能页也比一遍。控制台错误取 `Runtime.consoleAPICalled`(error)、`Runtime.exceptionThrown`、`Log.entryAdded`(error)；CSP 违例取 `Audits` 的 CSP issue 与页面内 `securitypolicyviolation`；另记 `file:`/`data:` 以外的请求。

**夹具**：在 lanes 夹具上用 `writeLaneFindings`/`addWrittenFeature`/`writeRanks`/`rankEntry` 造 4 个功能、11 条 findings：F1 4 条（P0、P2、P1、P0）、F2 3 条（P1、P2、P0）、F3 2 条但定级文件漏一条（不过检查，未定级）、F4 2 条无定级文件；每条理由文字各不相同。`check-priorities` 退出 1（F1、F2 ranked；F3 `F3-2 has no priority`；F4 文件缺失；`batch 1: F3 F4`），然后 `aggregate`、`assemble`、`page`。`findings.json` 顺序为 F1-1、F1-4、F2-3（P0），F1-3、F2-1（P1），F1-2、F2-2（P2），F3-1、F3-2、F4-1、F4-2（未定级）。

**装置先验**：
- 在夹具页面副本的数据块里把 F2-1 从 P1 改成 P2（产物文件不变）：探针报出 4 项，都指向 F2-1——findings 页 F2-1 级别不符、P1 筛选 1≠2、P2 筛选 3≠2 且多出 F2-1、F2 功能页 F2-1 级别不符。
- 在真实副本 A（O6 之后）的页面副本里把 F4-2 从 P0 改成 P1：探针报出 5 项，都指向 F4-2（含真实点击 P0 按钮后显示 5 条而不是 6 条）。
- 把夹具页面数据的总览 P0 计数加 1：探针报出总览 P0 卡片 4≠3。

**结果：**

| 输入 | 检查项 | 不符 | findings / 卡片 | 总览 P0/P1/P2/未定级 | 筛选后显示（= `findings.json`） | 控制台错误 / CSP 违例 / 外部请求 |
|---|---|---|---|---|---|---|
| 夹具 | 11 | 0 | 11 / 11 | 3/2/2/4 | 3/2/2/4 | 0 / 0 / 0 |
| 真实副本 A（O6 的输出） | 11 | 0 | 56 / 56 | 6/17/33/0 | 6/17/33/0 | 0 / 0 / 0 |

- 两份页面里每个级别筛选的 `data-result-count` 等于显示条数，对应按钮 `aria-pressed=true`；点 P0 按钮后片段为 `#/findings?priority=P0`。功能页 findings 合计 11 与 56，与 `findings.json` 同序同级别。
- 真实副本 A 没有未定级的 finding，未定级筛选显示 0 条（期望也是 0）；未定级的显示由夹具覆盖（4 条）。
- **满足。**

### O6 真实冒烟

- 运行前：
  - 把真实副本 A 复制到 scratchpad 的新目录，删掉 `report.html`，原目录不动。
  - 副本的功能（`jq`）：F1 verified 1、F2 failed 1、F3 verified 1、F4 verified 1、F5 verified 1。按 O6 的修订，**期望泳道派发 1 次**（F2）。
  - 用克隆里的 `skills/excavator/consumer-freshness.mjs <语料根>` 算出的 `currentSourceRevision` 为 `fresh`，与副本 `index.json` 的 `sourceRevision` 相同，满足运行条件。
  - `claude auth status`：`loggedIn: true`（claude.ai）。没有其他 `claude -p` 并行。
  - 语料 `.excavator/` 的文件清单与修改时间（`stat -f '%m %N'`，排序）与每个文件的 sha256 存档，共 45 个文件。
- 运行：`claude -p "/excavator:excavator-prd-report <语料根> --scope <A 的 scope> --out <该副本>"`，`--model claude-sonnet-5-5`（被接受；stderr 只有一行 `unrecognized_model` 提示，会话的全部 assistant 消息与 4 个子代理都是该模型）、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`、`--max-budget-usd 15`、`--plugin-dir` 为 d8a9fa8e 的已构建克隆、`--output-format json`、`--permission-mode dontAsk`、`--permission-prompts none`；设置文件：沙箱 Bash（只许写输出目录，禁写语料与克隆），放行 Agent、Read/Grep/Glob、只限输出目录的 Write/Edit 与四个 MCP 读工具，禁用三个写 facts 的 MCP 工具。后台运行，跑完再查。
- 结果：退出 0，`subtype: success`、`is_error: false`，40 轮。全部工具结果中没有权限拒绝，子代理也没有失败的工具调用。
- 派发次数（从主会话 transcript 的 Agent 调用与 4 个子代理文件数）：
  - **泳道 1 次**（F2，带上次 `check-lane` 的失败行重派），等于期望 1。F2 这次 `check-lane` 退出 0，核对后为 `verified`，`attempts` 2。
  - 核对子代理 2 次（F2 的章节核对 1 个分组、跨节一致性 1 个），属 `excavator-verify` 流程。
  - **排序子代理 1 次**，覆盖 F1–F5；排序步骤第一次 `check-priorities` 打印 `batch 1: F1 F2 F3 F4 F5`（1 批，56 条），**等于批数 1**。排序后 `check-priorities` 退出 0（`Rank: 5 features ranked, 0 unranked`），没有重派。
- 运行后：
  - 用克隆的 `prd.mjs check-priorities <副本> --project <语料根>` 再查一次：退出 0，5 个功能 ranked、0 unranked。
  - `findings.json` 56 条，`priority` 与 `priorityReason` 为 null 的各 0 条；P0 6、P1 17、P2 33；按 D5 的三重键排序成立；理由最长 235 字符。`index.json` 每个功能四个级别之和等于该功能 findings 条数（F1 1/4/7/0 = 12、F2 1/6/7/0 = 14、F3 1/3/7/0 = 11、F4 3/1/5/0 = 9、F5 0/3/7/0 = 10）。
  - 最后回复（路径以占位写出）：
    ```
    <out>/PRD.md
    Report page: <out>/report.html
    5/5 features written, 0 failed
    21 diagrams
    24 product, 32 technical findings, anchors checked: 6 P0, 17 P1, 33 P2, 0 unranked
    Statements: 178 verified, 5 contradicted, 6 misattributed, 0 unverifiable; open items: 11 resolved right, 3 resolved wrong, 19 still open; cross-section conflicts: 7, not checked: 0
    ```
    四个级别之和 6 + 17 + 33 + 0 = 56，等于 24 + 32。
  - `report.html` 写出，6,374,423 字节（其页面检查见 O5）。
  - 输出目录里改动的只有 F2 的章节、findings 与核对文件、`overview.md`、`index.json`、`findings.json`、`tables/*.md`、`PRD.md`，新增 `priorities/F1–F5.json` 与 `report.html`；F1、F3、F4、F5 的章节、findings 与核对文件字节不变。
  - 语料 `.excavator/`：运行前后文件清单、修改时间与内容都相同，0 个文件新于开始标记。
- 花费 $6.32（`total_cost_usd` 6.3177，只用了 `claude-sonnet-5-5`），墙钟 899 秒（`duration_ms` 897,058）。
- 运行中照记的几处（不影响以上判定）：
  - 主模型在续跑检查时（派泳道之前）先跑了一次 `check-priorities`（当时打印 `batch 1: F1 F3 F4 F5`），只读。
  - 派排序子代理之前，主模型自己执行了 `mkdir -p <out>/priorities`；没有写或改任何定级文件。
  - 排序子代理用 Bash 里的 python 写出 5 个定级文件；读源码时整文件 `cat` 并在子项目内 `grep -rn`，超出提示词「每段引文附近几十行」的范围。
  - 主模型 13 次 Edit 都是对 `features/F2.md`，属核对的 `--fix` 步骤。
- **满足。**

### O7 判据符合度（独立审读）

- 审读者 A：Opus，干净上下文。它读 O6 输出的 `findings.json`，能看到给定的级别与理由，再读证据与源码。抽样按 O7：P0 全部（6 条），P1、P2 按级别 × 类别分层，每格 5 条（按 id 排序后等距取），共 26 条。
  - 26 条里 20 条与给定级别相同，6 条差一级，0 条差两级。
  - 6 条都比审读者 A 的级别高一级：2 条 P0 → P1，4 条 P1 → P2。审读者 A 给的理由是：没有可绕过的检查、在项目里找不到调用方，或者理由没点出它那一级的判据。
  - 硬性不通过：无。
- 针对这一偏高，试过两次收紧排序提示词。都只用排序步骤重跑，各在 O6 输出的一份副本上删掉 `priorities/` 与 `report.html`，派 1 个排序子代理，每次约 $1.1–1.5、2–3 分钟。
  - 第一次（3590be5e）：要求给 P0、P1 前在代码里找到判据需要的东西（被绕过的检查、调用方、错误结果），找不到就降一级。结果 P0/P1/P2 = 1/8/47。两条每个请求都失败的路由被降到 P2，因为在项目里找不到它们的调用方，或者 panic 被全局恢复中间件接住。审读者 A 把这两条判为 P0，按 O7 是硬性不通过。
  - 第二次（99c77272）：补一句「已注册的路由本身就是入口；被恢复中间件转成错误响应仍算失败」。结果 P0/P1/P2 = 4/15/37，与审读者 A 有 16/26 相同、0 条差两级，分歧两个方向都有。
- 审读者 B：另一个 Opus，盲审。它的输入是去掉 `priority` 与 `priorityReason` 的 findings，共 31 条：上面 26 条，加上第二次收紧后新出现在样本外的 5 条 P1。它自己定级，并标出每条是 firm（代码能定）还是 borderline（取决于判据留下的判断）。结果是 firm 11 条、borderline 20 条。
  - 两位审读者在共同的 26 条上 23 条相同，作为一致率的上限参考。
- 各版本对照。共识 P0 指两位审读者都判 P0 的 3 条；「高/低」指比审读者高或低一级。

| 提示词 | 运行 | P0/P1/P2 | 对 A（26） | 对 B（31） | 两审读者一致的 23 条 | 共识 P0 召回 | 差两级 |
|---|---|---|---|---|---|---|---|
| 原版（d8a9fa8e） | O6 | 6/17/33 | 20 相同，高 6、低 0 | 22 相同，高 8、低 1 | 17 | 3/3 | 0 |
| 第一次收紧（3590be5e） | 重跑 1 | 1/8/47 | 18 相同，高 1、低 7 | 21 相同，高 1、低 9 | 17 | 2/3 | 1（firm P0 判 P2） |
| 第二次收紧（99c77272） | 重跑 2 | 4/15/37 | 16 相同，高 6、低 4 | 21 相同，高 7、低 3 | 15 | 2/3 | 0 |
| 原版（548789c9，与 d8a9fa8e 同树） | 重跑 3 | 7/23/26 | 17 相同，高 9、低 0 | 19 相同，高 12、低 0 | 15 | 3/3 | 0 |

- 原版两次运行之间：56 条里 48 条相同，0 条差两级。
- 决定：用 8ed904d6、548789c9 撤回两次收紧，保留原版提示词。理由：
  - 两次收紧都没有提高与任何一位审读者的一致率；
  - 第一次造成硬性不通过；
  - 第二次漏掉一条两位审读者都判 P0 的 finding；
  - 原版两次运行都不漏共识 P0，也没有差两级。
- 原版的已知特性：分歧只朝一个方向，比审读者高一级。两次运行对审读者 B 的 31 条共高 8 与 12 条、低 1 与 0 条。P0 里有 3–4 条在两位审读者那里是 P1。每张卡片显示定级理由，读者可以据此复核。
- **满足**（硬性条件无违反；一致率与分歧逐条记录在 scratchpad 的审读表里，不进仓库）。
