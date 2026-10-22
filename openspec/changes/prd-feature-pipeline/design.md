## Context

- 动机见 proposal.md；契约见 `specs/prd-generation/spec.md`。
- 验收语料 go-multirepo 的现状（2026-10-22 实测）：根目录不是 git 仓库，5 个成员仓库（Express 1 个、gin 3 个、React 18 + react-router 7 1 个）；`.excavator/` 里事实图 10,483 节点、36,478 边，**没有 `endpoint` 节点、没有 `routes` 边**；有 `domain-graph.json`（9 domain / 36 flow）。所以入口不能从事实图取，只能从源码模式取。
- go-multirepo 的 `.excavator/` 由别的运行维护，本变更的任何运行**不得增删改**其中的既有文件。
- 现有 skill 的写作规则（As-Is、全流程、正文无代码、枚举翻译、源专名、五类高危陈述先取证、mermaid、证据折叠、`$LANGUAGE` 段落）全部保留，只是搬进泳道子代理的提示词。
- 子代理派发沿用 `excavator-doc-map` 的做法：提示词内联在 SKILL.md、子代理直接写文件、一条消息里派多个、缺文件的批次重派一次。不新增 `agents/` 定义。

## Goals / Non-Goals

**Goals**
- 清单、范围、状态、计数全部落盘并由脚本守恒；模型只做分组、写作与判断。
- 每条功能泳道的上下文只装它自己的范围。
- 中断后重跑只补缺。
- findings 的每一条都能被脚本证明「模型读过这段代码」。

**Non-Goals**
- 见 proposal.md 的两段「不做」。
- 不改 `excavator-verify`、不改事实图、不新增 skill。

## Decisions

### D1 入口候选由模式目录脚本列出，模型只分组

`prd.mjs entrypoints <projectRoot> [--scope <subdir>]` 读 `entrypoint-catalog.json`，按事实图头部 `frameworks`（没有图时按目录里的构建文件）选模式，逐行正则扫描源码，输出候选 `{id, kind: route|page|job|main, file, line, text, framework}`。模式目录是数据：每个框架一组 `{kind, pattern, pathHint?}`。本变更至少覆盖 express、gin、react-router 与 go cron / node-schedule。

每个检测到的框架落且只落一个桶：`covered`（有模式）或 `uncovered`（没有模式）。`uncovered` 写进 `index.json.candidates.uncovered`，并在回复里报出；模型对这些框架补的入口记 `provenance: inferred`，每条必须带 `file:line`，`check-index` 核对该文件存在、行号存在。

不用 `domain-graph.json` 做候选：它是模型写的。模型分组时可以参考它的 flow 名，但守恒只对候选成立。

### D2 `index.json` 是唯一的清单与状态源

```
format: excavator-prd/1
sourceRevision, factsDigest|null, language, role, scope|null, frameworks
candidates: { byFramework: {<fw>: n}, uncovered: [<fw>], items: [候选] }
features: [ { id: F<n>, name, kind: flow|automated, chapter, entrypoints: [候选 id],
              seedFiles: [path], tiers: [frontend|backend], status, attempts,
              failure: null | { step: lane|check-lane|verify, reasons: [] },
              counts: { diagrams, evidence, findings: { product, technical },
                        verification: null | { verified, contradicted, misattributed, unverifiable,
                                               resolvedRight, resolvedWrong, stillOpen, conflicts, notChecked } } } ]
unassigned: [候选 id]
conservation: { candidates, assigned, unassigned, holds }
glossary: [ { term, meaning } ]
residualAssumptions: [string]
```

守恒两条：候选 = 各功能 `entrypoints` 去重之和 + `unassigned`，且每个候选只属于一个功能；功能数 = `planned + written + checked + verified + failed`。任一不成立，`check-index` / `aggregate` 退出非零并打印差集。

每个 `F<n>` 的 `seedFiles` 是泳道的阅读范围：入口文件及其直接 import/call 的文件（模型按事实图一跳列出）。自动化行为（定时任务、后台作业）也是功能，`kind: automated`，走同一条泳道。

### D3 泳道只写两个文件，脚本检查它们

泳道子代理的提示词给它：功能 id、名称、范围声明、术语表、`$LANGUAGE`、`--role`，以及搬过来的写作规则全文。它写：

- `features/F<n>.md`：YAML front-matter（`id, name, kind, roles: [], triggers: [], chapter`）+ 该功能的 PRD 章节（目的、角色、触发、前端、后端、缝合、步骤、规则、边界情况、mermaid、`<details>` 证据）。
- `findings/F<n>.json`：`{ "findings": [ { id: F<n>-<k>, class: product|technical, statement, flows: [F<n>], evidence: [ { file, passage } ] } ] }`。`statement` 只陈述现状里的缺陷，不写修法；没有发现就写空数组。

`prd.mjs check-lane <out> <id>`：front-matter 的 id 与功能一致；至少一个 mermaid 代码块；至少一个 `<details>` 证据块；每个 `path:line[-line]` 锚点收敛到项目根内（拒绝 `..` 与绝对路径）、文件存在、行号不超过行数；findings 的每段 `passage` 在其文件里按 doc-map 的归一化规则**恰好出现一次**，脚本算出 `line` 写回；`class` 只能是两个值；`statement` 过建议性措辞正则（英文与中文模式，源码里用 `\u` 转义）。任一不过，泳道标 `failed`，原因列表进 `index.json`，文件保留供查看。

引文恰好一次是故意的：它证明模型读过那段代码，而不只是知道文件名。

### D4 并发按批、前台等待、返回即检查

一条消息里最多派 `--concurrency` 个泳道（默认 3），前台等待；每条泳道返回后立即 `check-lane`，再派下一批。不用后台子代理：无人值守的 `claude -p` 只等后台任务 600 秒。

一条泳道返回后文件缺失，重派一次；两次都没有就 `failed`，原因 `lane-wrote-nothing`。`attempts` 记在功能上。

### D5 核对在编排者里按功能串行，不在泳道里

每个 `written` 且 `check-lane` 通过的功能，编排者按 `excavator-verify` 的流程对 `features/F<n>.md` 跑 `--fix`，报告写到 `verification/F<n>.md`，把它最后回复的固定几行原样存成 `verification/F<n>.txt`。`aggregate` 从这几行解析计数；解析不了就 `failed`，原因 `verification-reply-unparsed`。

不让泳道子代理自己跑 verify：verify 自己要派子代理，子代理里再派子代理不可靠；而且核对要干净上下文。

findings 不过模型核对（proposal 的「不做」）：`verdict` 固定写 `anchor-checked`，页面与报告都这么称呼它。

### D6 断点续跑按状态

状态流转：`planned → written → checked → verified`，任一步失败 → `failed`。重跑时：`verified` 跳过；`written`/`checked` 只补后面的步骤；`planned`/`failed`（`attempts < 2`）重派泳道；`failed` 且 `attempts = 2` 保持。`--fresh` 删除 `<out>` 后重来。`index.json` 的 `sourceRevision` 与当前快照不同时，不续跑：提示用 `--fresh`。

### D7 汇总与拼装是脚本，模型只写总览散文

`prd.mjs aggregate <out>`：重算状态与守恒，合并 `findings/*.json` 为 `findings.json`（每条带 `feature`、`verdict: anchor-checked`），从 front-matter 生成角色×功能表、覆盖表（候选 → 功能 → 状态）、核对计数表，写到 `tables/*.md`，并在 stdout 打印回复要用的计数。

模型写 `overview.md`：文档信息（范围大小按现有命令统计）、产品概述、角色、自动化行为概览、术语表引用。表格一律由脚本生成、由 `assemble` 插入，模型不转写。

`prd.mjs assemble <out>`：按 `chapter` 顺序把 `overview.md`、`tables/`、`features/*.md`（去掉 front-matter）、附录（覆盖表、核对表、`failed` 功能及原因）拼成 `PRD.md`。字节级确定。

### D8 只写 `--out`，不碰目标的既有产物

skill 读 `.excavator/` 只为事实与新鲜度；`stale`/`missing` 只提示，**不运行** `/excavator`、`sync_facts` 或任何重建。所有写操作限于 `--out`（默认 `<projectRoot>/.excavator/prd/`）。对 go-multirepo 的每次验收运行都用 `--out` 指向语料外的目录。

### D9 回复由命令打印、数字来自 `aggregate`

最后回复的行：`PRD.md` 路径；`<written>/<total> features written, <failed> failed`；`<N> diagrams`；`<P> product, <T> technical findings, anchors checked`；核对合计行（`aggregate` 对各功能计数求和后打印）；`uncovered` 框架一行（为空则省略）；保存提议。全部由 `aggregate` 的 stdout 填入 printf，模型不做加法。

## Risks / Trade-offs

- 跨功能一致性弱于单篇：术语先给、每泳道术语自检，冲突桶留给后续变更。
- 模式目录会漏入口（装饰器注册、动态路由）；漏的由模型补并标 `inferred`，`uncovered` 可见。这是覆盖缺口不是编造。
- 一条泳道的 PRD + findings 共享一个上下文，findings 的「问题」措辞可能漂回建议；靠 D3 的正则门与验收抽查兜底。
- 核对串行会拉长墙钟；接受，verify 内部自己并发。

## Acceptance oracles

- **O1 单测（合成夹具，不含真实语料）**
  - `entrypoints`：三框架夹具各列出已知条数；一个未知框架落 `uncovered`。
  - `check-index`：先验装置——从一份合法 index 删掉一个候选的归属，必须红并打印该候选 id；重复归属必须红。
  - `check-lane`：五个故意坏的泳道各自红（锚点越界 `..`、行号超出、引文出现两次、引文不存在、statement 含 "should"）；一个合法泳道绿，且脚本写回的 `line` 等于夹具里的已知行。
  - `aggregate`：状态桶之和等于功能数；`verification/*.txt` 缺一行时该功能 `failed`。
  - `assemble`：同一输入两次输出字节相同；`failed` 功能出现在附录。
  - 源码零中文字符（现有门）。
- **O2 契约测试**：五个 Phase 顺序；`$LANGUAGE` 段落位置（沿用现有测试）；并发默认值 3 与「前台等待」字样；续跑规则；只写 `--out` 与「不运行 /excavator」字样；回复命令的行与 `aggregate` 的字段一一对应。
- **O3 机制冒烟（每个代码 commit 后）**：`claude -p --model claude-sonnet-5`、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`，对 go-multirepo 根目录 `--scope go-multirepo-auth --out <scratch>`。通过条件：`index.json` 存在且守恒成立；每个功能落在一个状态桶；至少一个功能 `verified`；`findings.json` 每条 `verdict: anchor-checked`；`PRD.md` 拼出；运行前后 go-multirepo `.excavator/` 的 `find -newer` 为空且文件清单相同；stderr 没有 "terminating"，最后一条 result 是回复的固定行。
- **O4 全量关口（合并前一次）**：同样的命令，不带 `--scope`，`--concurrency 3`。记录模型、`total_cost_usd`、墙钟进 PR。通过条件同 O3，另加：`uncovered` 为空或只含验收人认可的框架；验收人按 class 分层抽 10 条 findings 读证据，逐条记「信号属实 / 不属实」，不属实为 0；功能名与 `domain-graph.json` 的 36 个 flow 只做重叠计数报告，不作判据。
- **O5 中断续跑**：O3 的运行在第一批泳道返回后人为终止，再次运行同一命令，`verified` 的功能不重写（mtime 不变），其余补齐。
