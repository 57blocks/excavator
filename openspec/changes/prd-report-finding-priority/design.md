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
- **O6 真实冒烟**：把用户刚跑完的那个子项目产物复制到 scratchpad（不动原目录），以 `claude -p` 跑 `/excavator-prd-report`，`--out` 指向副本，钉 `--model` 为 Sonnet、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`：0 次泳道派发，排序子代理派发次数等于 `check-priorities` 打印的批数，最终 `check-priorities` 退出 0，全部 findings 有级别，回复的 findings 行四个级别之和等于 findings 条数，写出 `report.html`；语料 `.excavator/` 运行前后文件清单与修改时间相同。记录花费与耗时。若源码快照与副本的 `sourceRevision` 不同，记为「未跑」并写明原因。
- **O7 判据符合度（独立审读）**：一个不知道排序子代理结果之外任何上下文的 Opus 审读者，对 O6 的结果审读全部 P0 与按级别、类别分层的抽样（每级至少 5 条，不足则全部）：读 finding、证据与源码，判断理由点名的判据是否被证据支持，以及有没有更高一级的判据被证据支持。记录一致率与分歧逐条；**硬性不通过**：任何一条被审读者以证据判为满足 P0 判据却被定为 P2（差两级）。
