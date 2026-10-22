## Context

`annotate-graph.mjs` 的 `buildExpectedRecords` 把调用记录按 `calls|<调用方文件>|<callee 原文>` 聚合：同一文件里同名的调用点合成一条，`line` 取最小行，`sites` 记个数。`findRecord` 对模型的 `calls` 边取「源节点的 `filePath` + 目标节点的 `name`」查这张表，查到即匹配：

- 边得到 `provenance: "extracted"` 与证据行，或者核对模型自己引的行；
- 记录的键进 `matchedRecordKeys`，之后 `edge-missing|calls` 不再计这个键下的调用点。

`resolveUniqueCallSites` 对每个调用点在「调用方文件 + import 目标」里按 callee 原文找同名声明，分成 unique、ambiguous、unresolved 三组。unique 的记录带 `targets: [<唯一的文件>]`。它现在只用来决定哪些调用点有资格计入 `edge-missing|calls`，`findRecord` 不读它。

作用域按文件定：同一文件里 callee 原文相同的调用点，作用域相同、候选相同，因此解析结果相同。

## Goals / Non-Goals

**Goals:**
- 调用点唯一解析时，指向别处同名声明的模型边不再被当作有抽取记录支撑；
- 这种边是一个看得见、有名字的发现，带计数与样本；
- 编造与遗漏分开算：指错目标的边不顶替被它指错的调用点。

**Non-Goals:**
- 不改作用域，不改 `resolveUniqueCallSites`。作用域的精度由 PR 57blocks/excavator#66 与后续变更负责，本规则读它的结果，跟着变；
- 有歧义或无法解析的调用点照旧只按名字匹配，本变更不收紧它们；
- 源端不在本变更内：匹配仍按调用方文件，不看调用方是文件里的哪个函数。同文件里另一个函数调用了 `log`、模型却从不调用它的函数画边，这类边仍会被匹配。这是既有缺陷，作为后续工作提出；
- 不改事实图。事实图自己按同一作用域画调用边，不经过 `findRecord`。

## Decisions

### D1 唯一解析的调用点只支撑指向那个声明的边

审计在处理边之前先算 `resolveUniqueCallSites`，把 unique 组整理成 `<文件>|<callee>` 到唯一目标文件的映射。`findRecord` 对 `calls` 边按名字查到记录后，再看这个映射：

- 键在映射里，且目标节点的 `filePath` 不等于映射给出的文件 → 目标不符，不算匹配；
- 键在映射里且文件相同 → 照旧匹配；
- 键不在映射里（调用点有歧义或无法解析）→ 照旧只按名字匹配。

目标节点没有 `filePath` 时，它不可能是那个文件里的声明，同样算目标不符。

只比文件不比到具体声明：解析结果本身就是文件级的（同一文件里两个同名声明合成一个命中，那是 `identity-collision` 管的事）。

映射按 `<文件>|<callee>` 建，依赖上面 Context 里「同一文件同名调用点解析相同」这一条。作用域以后若改成逐调用点，这里要一起改；代码注释写明这个依赖。

### D2 目标不符的边怎么标

- `verification: "contradicted"`。审计手里的事实说这个调用点去的是另一个声明，这正是「源码说的不一样」；
- 模型写了 `provenance: "extracted"` 就保留，否则记 `inferred`。和没有记录的边相同：没有记录支撑它；
- 不附证据行。那一行支撑的是指向另一个声明的边，附上去等于替这条边作证；
- 模型自己写的 `evidence` 原样保留，不加 `verified`。

模型自己写了 `inferred` 的边同样检查。`findRecord` 一直对每条边运行，按名字匹配到记录的 `inferred` 边会被改成 `extracted`；既有要求里「`inferred` 边不与期望记录比较」，代码与用例实际守的是「没有记录时不计 `edge-unsupported` 与 `edge-auto-inferred`」，本变更不改这一点。规范与代码在这句话上的出入早于本变更。

为什么用 `contradicted` 而不是 `unverified`：`unverified` 说的是「没有记录」，而这里审计有记录，记录指向别处。非 Java 文件的事实图用同一个作用域画调用边，并把结果当作 `extracted` 的事实写进图；同一个解析结果用来判模型的边，不多出一类新的断言。解析本身有错的情形见「残余假设」。

### D3 计数：新缺口叠加在既有计数上

- 新缺口 `edge-target-mismatch`，scope `calls`，计数为目标不符的边数。样本格式：`<source> -> <target>: <调用方文件>:<行> <callee> resolves to <文件>`，行取该键下最小的调用行，和记录的 `line` 相同；
- 这条边照旧走「没有记录」的计数：模型写了 `extracted` 的计入 `edge-unsupported`；`provenance` 由审计补成 `inferred` 的计入 `edge-auto-inferred|calls`；模型自己写了 `inferred` 的不计这两项；
- 不计入 `edge-contradicted`：那一项说的是「引的行与记录不符」，这里没有可比的行。

为什么叠加而不是独占：`edge-unsupported` 与 `edge-auto-inferred` 的说明都是「没有抽取记录支撑」，对目标不符的边同样成立。独占会让这两项的计数少于它们自己说明的数。同一条边计两类，先例是 `evidence-corrected` 与 `edge-contradicted`。各类缺口是同一批边的不同侧面，不是一个划分；要数编造的边，按边去重，不能把各类相加。

### D4 与 `edge-missing|calls` 的关系

目标不符的边不把键放进 `matchedRecordKeys`。没有别的边指向解析出的声明时，这个键下的每个唯一调用点照旧计入 `edge-missing|calls`。

因此，模型只画了一条指错的边时，审计报两件事：一条 `edge-target-mismatch`（多了一条事实不支持的边），加上该键下调用点个数的 `edge-missing|calls`（少了事实支持的边）。模型既画了对的边又画了错的边时，只报 `edge-target-mismatch`。

理由：`AGENTS.md` 要求编造与遗漏分开算。把被指错的调用点算作「已有边」，等于用一条编造的边抵掉一次遗漏，两边的数都会失真。

### D5 输出

- `audit.json` 的 `counts` 加 `edgeTargetMismatch`；
- 缺口按既有的 `gap()` 生成，计数为 0 时不出现。所以真实语料上没有目标不符的边时，标注后的图与缺口列表逐字节不变，`audit.json` 只多一个为 0 的计数；
- stderr 汇总行加 `edge-target-mismatch=<n>`，等于图里该缺口的计数；
- `SKILL.md` 第 2.3 阶段「What it adds」里写明这类边标 `contradicted` 并计入 `edge-target-mismatch`。

## 残余假设

唯一解析用的是审计既有的按名字作用域。它有已知盲区，盲区里「唯一」会指错，这时模型画对的边会被报成目标不符：

- 不需要 import 就能调用的文件不在作用域里：Go、Java、Kotlin 的同包文件，Java 继承来的方法；
- Kotlin 的成员调用只记方法名，`repo.save()` 的 callee 是 `save`，于是按名字落进作用域里任何声明了 `save` 的文件；
- 同一文件里同名的调用点合成一个键，审计分不出模型的边对应哪一个调用点。

非 Java 文件的事实图用同一作用域画边，所以这类误报和事实图自己的错边同源；修正作用域的变更会同时消除两处。Java 的事实图按接收者类型解析，不用这个作用域，但审计对 Java 也用按名字的作用域；Java 的成员调用 callee 是 `obj.method` 原文，只有不带接收者的调用会按名字落进作用域。

## 验收 oracle（动手前写死）

- **O1 复现（在 origin/main 的代码上失败）**：`tests/skill/excavator/test_annotate_graph.test.mjs` 加一组用例。夹具：`src/app.ts` 导入 `./helper` 并在 `run` 里调用 `helper()`；`src/other.ts` 也声明 `helper`，`app.ts` 不导入它。调用点唯一解析到 `src/helper.ts`。
  - a. 模型边 `run → other.ts#helper`，没写 `provenance`：边得到 `inferred` 与 `contradicted`，没有 `evidence`；
  - b. 同一情形：`edgeTargetMismatch` 为 1；缺口 `edge-target-mismatch`（scope `calls`）计数 1，样本含这条边与 `src/helper.ts`；`edge-auto-inferred|calls` 为 1；
  - c. 同一情形：`edge-missing|calls` 为 1，这个调用点没有被错边顶替；
  - d. 模型写了 `extracted` 并引了调用行：`provenance` 仍是 `extracted`，`verification` 是 `contradicted`，`evidence` 与模型写的完全相同，`edge-unsupported` 为 1，`evidenceVerified` 为 0；
  - e. 模型同时画了 `run → helper.ts#helper` 与 `run → other.ts#helper`：前者照旧 `extracted` 并带证据行 4，后者目标不符；`edge-missing|calls` 不计这个调用点；
  - f. stderr 汇总行有 `edge-target-mismatch=`，等于图里该缺口的计数（既有端到端用例的图里没有目标不符的边，两者都是 0；非 0 时的计数由 b 管）；
  - g. 模型自己写了 `inferred`：`provenance` 仍是 `inferred`，`verification` 是 `contradicted`，`edgeTargetMismatch` 为 1，`edge-auto-inferred|calls` 不计。

  在改动前的代码上跑一次，记录失败的断言。
- **O2 不误报（改前改后都成立）**：
  - a. `app.ts` 同时导入 `./helper` 与 `./other`，调用点有歧义：边 `run → other.ts#helper` 不标 `contradicted`，`edgeTargetMismatch` 为 0；
  - b. `app.ts` 什么都不导入，`helper` 调用点无法解析：同一条边不标 `contradicted`，`edgeTargetMismatch` 为 0；
  - c. 既有用例全部照旧通过，包括指向正确目标的边带证据行。
- **O3 门**：三件套（`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`），`node scripts/check-refs.mjs`（改了 `SKILL.md`），`openspec validate --all --strict`。`pnpm test` 包含现有的审计用例与 Lazy 用例，它们全部通过即是「既有夹具与 Lazy 测试不受影响」的确定性检查。
- **O4 装置看得见**：逐个做变异，确认对应用例变红，然后还原。
  - i. `findRecord` 不看解析结果，回到只按名字 → O1 a–e、g 红；
  - ii. 目标不符时仍把键放进 `matchedRecordKeys` → O1 c 红；
  - iii. 有歧义的调用点也放进映射，取第一个候选 → O2 a 红；
  - iv. 不写 `contradicted` → O1 a、d、g 红；
  - v. 不生成缺口 → O1 b 红；stderr 不报该计数 → O1 f 红；
  - vi. 键不在映射里（调用点有歧义或无法解析）也按目标不符处理 → O2 a、b 红。
- **O5 真实语料（确定性，零模型）**：用 origin/main 与本分支的 `annotate()` 跑同一批输入，比较 `audit.json` 与标注后的图。输入是已有产物的快照：
  - go-multirepo 与 mixed-suite 两个成员（kotlin-portal、maui-app）的 Lazy 事实图，连同同一次运行的 `structure-all`、import map、扫描结果；
  - Lazy 强化用的公开语料 conduit 的事实图；
  - 一个公开 Go 仓库的模型图（旧版完整流程留下的 `assembled-graph.json` 及其结构与 import map）。

  判据：
  - 先用独立脚本数每份输入里「按名字能匹配、调用点唯一解析、目标文件不同」的边；
  - 这个数为 0 的输入：标注后的图逐字节相同，`audit.json` 只多 `counts.edgeTargetMismatch: 0`；
  - 装置先验：在一份真实事实图的副本里，把 N 条唯一解析的 `calls` 边改指向另一文件里的同名声明。比较脚本必须报出：`edgeTargetMismatch` 恰为 N，样本里的边都是改过的；`provenance`、`verification`、`evidence` 有变化的边恰是这 N 条；`edgeUnsupported` 增加 N（事实图的边写着 `extracted`）；`evidenceVerified` 减少这 N 条边上原本核对通过的条目数；`edge-missing|calls` 增加的数等于「只被改过的边覆盖的键」下的唯一调用点数；其它计数与缺口不变。

  记录只写计数与摘要，不写路径。

## 验收记录

- **O1 复现：** 把本分支的测试文件放进 origin/main（`50c7dae2`）的分离检出，对改动前的代码跑：35 个用例里 9 个失败。之后 main 前进到 `8644761c`，本分支随之变基；两者之间 `skills/excavator/`、这个测试文件与 `facts-audit` 规格都没有变化，所以这次运行与下面 O5 用的 main 代码仍是现在的 main。
  - O1 a–e、g 六个用例全部失败：错边被标 `extracted` 并拿到证据行，没有 `contradicted`，没有 `edgeTargetMismatch` 计数与缺口，调用点被错边顶替、`edge-missing|calls` 不计；
  - O1 f 失败：stderr 没有 `edge-target-mismatch=`；
  - O2 a、b 两个用例失败，只因为 `edgeTargetMismatch` 这个键在 main 上不存在；它们关于标记的断言（不标 `contradicted`）在 main 上通过。

  本分支上 35 个全过。
- **O2：** 有歧义与无法解析的调用点照旧按名字匹配，不标记、不计数；既有用例全部通过。
- **O4：** 每个变异都让对应用例变红，还原后全绿。
  - i 只按名字 → O1 a–e、g 六个用例红；
  - ii 错边仍覆盖调用点 → O1 c 红；
  - iii 有歧义的调用点取第一个候选 → O2 a 红；
  - iv 不写 `contradicted` → O1 a、d、g 红，另有 e 红（它也断言错边的标记），共 4 个；
  - v 不生成缺口 → O1 b 红；stderr 不报 → O1 f 红；
  - vi 不在映射里的键也按不符处理 → O2 a、b 红。
- **O3：** 在变基后的 `6387db65` 的分离检出上跑：`pnpm install --frozen-lockfile`、`pnpm -r build`、`openspec validate --all --strict`（47 项）、`node scripts/check-refs.mjs` 都通过。
  - `pnpm test`：205 个文件、5074 个测试里 5017 个通过、50 个跳过、7 个失败（9 个文件）。机器同时跑着其它会话，load average 在 134 到 250 之间；失败的都是超时（钩子 10 秒、测试 15 或 20 秒），外加部署端到端用例在墙钟超时升级里多数了一次信号，以及 vitest 的 `onTaskUpdate` RPC 超时；
  - 这 9 个文件（Lazy 驱动、Phase F 命令行、语义写入隔离、修订同步、`structure-all`、部署端到端）都不读审计的输出：部署用例只引入未改动的 `PIPELINE_VERSION`，仓库里没有别处解析审计的 stderr 汇总行；
  - 同一检出上把这 9 个文件串行单独重跑，默认超时，96 个测试全部通过。
- **O5：** 五份输入全部满足判据。
  - 规模：三套私有语料快照的事实图共 6,869 条 `calls` 边（go-multirepo 3,073，kotlin-portal 1,671，maui-app 2,125），conduit 70 条，公开 Go 仓库的模型图 48 条；
  - 独立脚本数出的目标不符的边：五份都是 0。五份的标注后的图逐字节相同，`audit.json` 只多 `edgeTargetMismatch: 0`；
  - 装置先验：conduit 改 5 条、三套私有语料各改 20 条。每一份里，计数的变化都与只用被改的边算出的预测相同，`provenance`、`verification`、`evidence` 有变化的边恰是被改的边。两边都用 origin/main 的代码时，同一比较失败（5 项判据不符）；
  - 判据漏写了一项，比较脚本按规则补进了预测：被改的边在 main 上若因引的行不是该名字的第一个调用行而被判 `edge-contradicted`（同时 `evidence-corrected`），在本分支上它是目标不符的边，不再核对行号，这两项相应减少。三套私有语料的被改边里分别有 11、3、17 条属于这种情况；
  - `edge-missing|calls` 的增量：go-multirepo 与 kotlin-portal 各 21（有一个键下有两个唯一调用点），maui-app 20，conduit 5，都与预测相同。

  这些输入里没有这个缺陷的实例，规则的效果只在夹具与人为植入的边上看得到。比较脚本与快照留在会话的临时目录，不进仓库。
- **既有问题（不在本变更内，作为后续工作）：**
  - 源端按文件匹配，见 Non-Goals；
  - 证据行核对拿边引的行与该文件里同名调用点的最小行比较。上面的快照上，origin/main 的审计已把事实图里 20%–59% 的正确 `calls` 边判为 `contradicted`（conduit 14/70，go-multirepo 774/3,073，kotlin-portal 936/1,671，maui-app 1,255/2,125），因为它们引的是同名的后一个调用点。
