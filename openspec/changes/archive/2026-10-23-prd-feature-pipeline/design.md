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

候选若标 `pattern`（或没有 provenance），`check-index` 要求它与 `$OUT/entrypoints.json` 里同 id 的条目在 kind、file、line、text、framework 上完全相等，模型抄不出脚本没列的候选；`inferred` 候选只核文件与行号存在。

每个 `F<n>` 的 `seedFiles` 是泳道的阅读范围：入口文件及其直接 import/call 的文件（模型按事实图一跳列出）。自动化行为（定时任务、后台作业）也是功能，`kind: automated`，走同一条泳道。

### D3 泳道只写两个文件，脚本检查它们

泳道子代理的提示词给它：功能 id、名称、范围声明、术语表、`$LANGUAGE`、`--role`，以及搬过来的写作规则全文。它写：

- `features/F<n>.md`：YAML front-matter（`id, name, kind, roles: [], triggers: [], chapter`）+ 该功能的 PRD 章节（目的、角色、触发、前端、后端、缝合、步骤、规则、边界情况、mermaid、`<details>` 证据）。
- `findings/F<n>.json`：`{ "findings": [ { id: F<n>-<k>, class: product|technical, statement, flows: [F<n>], evidence: [ { file, passage } ] } ] }`。`statement` 只陈述现状里的缺陷，不写修法；没有发现就写空数组。

`prd.mjs check-lane <out> <id>`：front-matter 的 id 与功能一致；至少一个 mermaid 代码块；至少一个 `<details>` 证据块；每个 `path:line[-line]` 锚点收敛到项目根内（拒绝 `..` 与绝对路径）、文件存在、行号不超过行数；findings 的每段 `passage` 在其文件里按 doc-map 的归一化规则**恰好出现一次**，脚本算出 `line` 写回；`class` 只能是两个值；`statement` 过建议性措辞正则（英文与中文模式，源码里用 `\u` 转义）。任一不过，泳道标 `failed`，原因列表进 `index.json`，文件保留供查看。

引文恰好一次是故意的：它证明模型读过那段代码，而不只是知道文件名。

### D4 并发按批、前台等待、返回即检查

一条消息里最多派 `--concurrency` 个泳道（默认 3），前台等待；每条泳道返回后立即 `check-lane`，再派下一批。不用后台子代理：无人值守的 `claude -p` 只等后台任务 600 秒。

一条泳道返回后文件缺失，或第一次 `check-lane` 不通过，都重派一次（重派的提示词在固定标题下附上 `check-lane` 打印的原因）；第二次仍缺文件就 `failed (lane)`，原因 `lane-wrote-nothing`；第二次仍不过检查就 `failed (check-lane)`。`attempts` 由 `mark dispatched` 记在功能上，一个批次的 `mark` 调用放在同一条命令里顺序执行；四个读写 `index.json` 的子命令都持排他锁。

### D5 核对在编排者里按功能串行，不在泳道里

每个 `written` 且 `check-lane` 通过的功能，编排者按 `excavator-verify` 的流程对 `features/F<n>.md` 跑 `--fix`，报告写到 `verification/F<n>.md`，把它最后回复的固定几行原样存成 `verification/F<n>.txt`。`aggregate` 按位置解析这几行的整数（4/3/2/2 个），与语言无关；解析不了就 `failed`，原因 `verification-reply-unparsed`。

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

### D9 回复由脚本打印

`prd.mjs reply` 打印最后回复的全部行（含条件省略：没有缺模式框架就没有那一行，`--out` 不是默认位置就没有保存提议，限定范围时默认路径是 `docs/PRD-<scope>.md`），模型只原样复述，非英文时译词、路径与数字不动。三次真实运行里模型自己按 printf 条件省略只对了一次，所以条件不能留给模型。行的内容：`PRD.md` 路径；`<written>/<total> features written, <failed> failed`；`<N> diagrams`；`<P> product, <T> technical findings, anchors checked`；核对合计行（`aggregate` 对各功能计数求和后打印）；`uncovered` 框架一行（为空则省略）；保存提议。全部由脚本算出，模型不做加法。

### D10 脚本生成的表与附录标题固定英文

`tables/*.md`、附录的标题与「Total」「unassigned」之类的固定词由脚本写，在任何 `--language` 下都是英文；模型写的 `overview.md`、各功能章节与 findings 的陈述跟随 `$LANGUAGE`。理由：这些词是产物字段的直接投影，翻译要么进模型（又回到转写）、要么进脚本的词表（每种语言一份）；两者都比"固定英文 + 源值原样"贵且更容易错。验收时记为设计例外。

### D11 候选的锚点一律核对，项目根来自调用方

`check-index` 对每个候选（不只 `inferred`）核文件存在与行号在界内：候选是模型抄进 `index.json` 的，抄错或捏造的锚点是编造通道。所有读 `<out>` 的子命令都要求 `--project <root>`，并拒绝与 `index.projectRoot` 不一致的索引；根不从模型写的字段取。

### D12 编排者不改泳道文件；`check-lane` 自己记结果

真实运行里编排者曾为让 `check-lane` 通过而改写泳道章节的锚点路径，也曾在核对后改写一条 finding 的陈述。这两种改动都绕开了「模型读过这段代码」的证明。规定：编排者 MUST NOT 编辑 `features/<id>.md` 与 `findings/<id>.json`；第一次 `check-lane` 失败就带着原因重派该泳道一次，第二次失败则 `failed (check-lane)`。`check-lane` 把自己的结果写进 `index.json`（失败记 `failure`，成功清除），`aggregate` 沿用它；`mark failed` 只剩 `lane` 这一步（两次没写文件）。核对失败仍由文件状态推出。

### D13 接受的重复与推迟项

- `excavator-verify --fix` 会在每个章节末尾追加该章节的核对摘要，拼装后与附录的核对表并存；接受这一重复，不让任何人去删模型产物里的段落。
- 旧 skill「留待确认前先查别的章节是否已回答」的规则在泳道里不成立（泳道看不到别的章节），留给跨功能的后续变更。
- 全文级的术语自检（不同泳道把同一术语译成不同写法）随 Phase 4 改为只读而取消；每条泳道仍拿到同一份术语表并自检，跨泳道的术语冲突留给跨功能的后续变更。
- `--out` 恰好等于默认路径时仍打印保存提议：它就是默认位置，提议成立。
- `--scope` 下框架列表仍取整个项目的图头，会多报 0 候选的框架；可见、不编造，不改。

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

## 验收记录（2026-10-22 至 10-23，语料代号 go-multirepo）

- 门：每个代码 commit 在分离检出跑三件套 + check-refs + typecheck + `openspec validate` + 隐私扫描；本机负载 150–270 时有超时抖动，失败文件单跑全绿，73cfb2fa 在负载 8 时一次全绿（216 文件 / 5182 测试）。
- O3 机制冒烟（`--scope go-multirepo-auth`，claude-sonnet-5）：18 候选（16 模式 + 2 推断）全部归属、0 unassigned、0 缺模式框架；5 功能全部 verified（各 1 次派发）；10 张图；52 条 findings（16 product / 36 technical）全部 anchor-checked；核对 126 verified / 4 contradicted / 1 misattributed，待确认 5 对 2 错 2 仍开；独立审计（含 strict）退出 0；`aggregate` 复算与回复一致，`assemble` 字节相同；费用 $18.78、3625 s、117 轮；语料 `.excavator` 前后清单与内容摘要一致（1114 项）。第一次尝试因账号用量上限中断（$5.96），记为作废。
- O5 两次中断续跑：第一次在第 4 条泳道派发后杀掉，第二次在第一条核对回复落盘后杀掉，第三次跑完；已 checked/verified 的功能不重派（attempts 不变、findings 内容摘要不变），只有在飞的 F4 重派一次；最终 4/4 verified、16 候选（13 归属 / 3 unassigned）、15 图、16 product / 24 technical；第三段费用 $6.43。
- 续跑探针（植入缺失种子文件与越界行号）：`check-index` 报出两处，运行只用 jq 修了这两处、0 次派发、16 个泳道文件字节不变；$0.62、166 s。
- O4 关口（`--scope go-multirepo-review`，99 条 gin 路由，并发 3，claude-sonnet-5）：102 候选（99 gin + 1 cron + 1 main + 1 推断），92 归属 / 10 unassigned；11 功能：8 verified、3 在 `check-lane` 两次失败后 failed（原因可见：锚点末行越界 ×2、引文多次出现 ×2、建议词门误杀源专名 ×2）；17 次派发（6 次重派）；36 图；100 条 findings（52 product / 48 technical）；核对 238 verified / 21 contradicted / 2 misattributed，待确认 5 对 12 错 17 仍开，跨节冲突 11；独立审计退出 0；分层抽查 10 条 findings（5 product / 5 technical，跨 6 个功能）逐条读源码，信号属实 10/10；与 domain-graph 的 4 条相关 flow 按含义对应 3 条全对 1 条部分；费用 $67.84、18103 s、182 轮；`.excavator` 不变。整语料全量按单价推算需 $300 以上，推迟到报告页变更落地后再跑一次。
- 最终 commit 上的复跑（270c7de0，claude-sonnet-5）：续跑探针——`check-index` 报出三处植入问题，模型只用一次 jq 修回（不重建索引）、0 次派发、24 个泳道文件字节不变、回复由 `prd.mjs reply` 打印，$0.45、100 s。O3 重跑（`--scope go-multirepo-auth`）：16 候选（13 归属 / 3 unassigned，0 推断）、6 功能（4 verified、2 在 `check-lane` 两次失败后 failed：第二次写的锚点没加反引号，已把这条规则写进检查信息与泳道提示词）、35 findings（16 product / 19 technical）全 anchor-checked、核对 121 verified / 4 contradicted / 1 unverifiable、独立审计（含 strict）退出 0、编排者未改任何泳道文件、回复来自 `reply`、`.excavator` 不变；$20.35、5744 s、122 轮。观察：批内 `mark dispatched` 没有严格放在一条命令里（9 次派发 9 次标记、计数仍准确，排他锁已兜底），记为模型遵从度观察。
- 评审修复轮：f5b5ecbc 拒（候选锚点只核 inferred、根取自模型字段）→ caaceb5b；701b4689 拒（续跑跳过 check-index、编排者自改泳道文件、保存提议行靠模型省略）→ 73cfb2fa；O4 后再修（回复改脚本打印、建议词门放过源专名、index.json 加锁、模式候选须等于脚本输出、续跑不重建索引）。
