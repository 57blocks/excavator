## Context

`.feature` 读取器是逐行的。它认四类行（Feature、Scenario/Scenario Outline、五个步骤关键字、`"""`/`'''`），其余一律跳过，也不看一行出现在什么位置。所以出现了 proposal 里的四个问题。这四个问题的共同根源是：一行该不该成结构，取决于它在文件里所处的位置，而读取器不看位置。

参考依据是 cucumber/gherkin 仓库 main 分支 `e2c8bc12`（2026-10-22 读取）上的三个文件：
- `gherkin.berp`：语法；
- `gherkin-languages.json` 的 `en`：关键字；
- `javascript/src/Parser.ts`：生成的解析器，含每个状态接受哪些记号、按什么顺序试。

参考解析器默认不在第一个错误处停下：遇到不接受的记号就记一个错误，跳过这一行，状态不变。

## Goals / Non-Goals

**Goals**
- 每个非空、非注释的行只有三种去处之一：
  - 落成一条记录（section 或 step）；
  - 按角色忽略（tag、描述、表格行、doc string）；
  - 记入 `unplaced`。
- 一行落在哪里，与参考解析器在同一位置的判断一致。
- 读取器仍是逐行、确定性的。

**Non-Goals**
- 不做 Gherkin 合法性校验器，只校验会改变记录或会吞掉行的规则（D6）。
- 不支持非英语方言（D5）。
- 不改 `steps` 在事实图里怎样成为节点。

## Decisions

### D1 先分类，再按上下文决定接受与否

**怎样分类。** 先去掉行首空白，再按以下顺序判断一行是什么。参考解析器在任何状态下，对同一行最多只有一类记号能匹配，所以分类与状态无关：
1. 在 doc string 里：是闭合分隔符或内容。
2. 空行、注释（`#`）。
3. tag（`@`）。
4. 标题：关键字加冒号。
5. 步骤：关键字加空格。
6. 表格行（`|`）。
7. doc string 分隔符（`"""` 或三个反引号）。
8. 其他文字。

**上下文。** 上下文取自最近一个被接受的标题，共五种：

| 上下文 | 进入方式 | 对应参考解析器的状态 |
|---|---|---|
| `start` | 文件开头 | 0–2 |
| `container` | Feature 或 Rule 标题 | 3–4、23–24 |
| `background` | Background 标题 | 5–10、25–30 等 |
| `scenario` | Scenario 标题 | 12–17、32–37 等 |
| `examples` | Examples 标题 | 19–21、39–41 |

后三种上下文另有一个 `body` 标志。见到第一个步骤（background、scenario）或第一个表格行（examples）时置位，之后就不再有描述。

「描述可用」指：上下文是 `container`，或者是另外三种之一且 `body` 未置位。

**接受表。** 下表中，「描述或放不下」的意思是：描述可用时算描述文字，否则记 `out-of-place`。

| 行 | 被接受的上下文 → 结果 | 其余上下文 |
|---|---|---|
| Feature | `start` → section L1，进 `container` | 描述或放不下 |
| Rule | 除 `start` 外 → section L2，进 `container`，此后都在 Rule 内 | `start`：放不下 |
| Background | `container` → section L2/L3，进 `background` | 描述或放不下 |
| Scenario | 除 `start` 外 → section L2/L3，进 `scenario` | `start`：放不下 |
| Examples | `scenario`、`examples` → 进 `examples` | 描述或放不下 |
| 步骤 | `background`、`scenario` → step，`body` 置位 | 描述或放不下 |
| 表格行 | `background`/`scenario` 且 `body` 置位 → 步骤参数；`examples` → `body` 置位 | 描述或放不下 |
| doc string 分隔符 | `background`/`scenario` 且 `body` 置位 → 打开 doc string | 描述或放不下 |
| 其他文字 | — | 描述或放不下 |
| tag、注释、空行 | 任何上下文 → 忽略 | — |

`start` 里描述不可用，所以除空行、注释、tag 与 Feature 外的行都记 `out-of-place`。

拿生成的解析器逐个状态核对过上表。几处容易看错的地方：
- 状态 3/4（Feature 描述）不接受 `StepLine`、`DocStringSeparator`、`TableRow`、`ExamplesLine`，这些行都落到 `Other`，也就是描述。
- 状态 12/13（Scenario 描述）在 `Other` 之前先试 `StepLine`，所以 Scenario 描述里以 Given 开头的行是步骤。task 里说 Scenario 描述里的这种行也被误记，按参考语法，这条不成立，见 D7。
- 状态 5–7（Background）不接受 `ExamplesLine`：在 Background 描述里它是描述，在步骤之后它放不下。
- 状态 21（Examples 表格行之后）不接受 `Other`，所以那里的步骤与文字都放不下。

**替代方案：照搬生成的 55 状态解析器。** 否决。D6 列出的那些区别不改变任何记录，五个上下文加一个标志已足够判断每一行的去处，代码量是照搬的零头。

### D2 放不下的行进新字段 `unplaced`

`StructuralAnalysis` 新增可选字段 `unplaced: Array<{ reason: string; lineRange: [number, number] }>`：

- 它不是符号数组，不计入 `deriveStatus` 的符号数。
- `extract-structure-result.mjs` 校验它，并以 `reason`、`startLine`、`endLine` 带进结果行。
- 覆盖账本把各段汇总成每语言一条 `unplaced-lines` 缺口：`count` 为行数，样本为 `路径:起-止 原因`。

相邻且原因相同的行合并为一段。只合并紧挨着的行，中间隔一个空行就分段，这样规则最简单，也足以避免一个散文文件产出几百条记录。

**替代方案。**
- 整个文件记 `parse-failed`。否决：同一文件里放得下的 section 与 step 是真的，丢掉它们是另一种静默丢弃。
- 只靠 `zero-symbol`。否决：已经有记录的文件是 `parsed`，它放不下的行仍然不可见；而且 `zero-symbol` 本身不产缺口。
- 每种原因一个缺口类型。否决：原因已经写在样本里；多一种类型，账本与读者都要多认一个名字。

`reason` 是封闭的三个值：`out-of-place`、`unclosed-doc-string`、`unsupported-language`。类型上写成 `string`，因为这个字段是通用的：别的逐行读取器以后也可以用它，到时再加它们自己的原因。

### D3 未闭合的 doc string 不恢复解析

参考解析器把开分隔符之后的行都当作 doc string 内容，到文件结尾报错。读取器照此处理：从开分隔符到最后一个非空行记一段 `unclosed-doc-string`，段内不产记录。

替代方案是把开分隔符当成放不下的行，然后从下一行接着解析。这样能捡回后面的结构，但 doc string 内容里的 `Given` 行会被记成步骤，即编造。零编造优先于覆盖，所以否决。

### D4 描述里的分隔符不打开 doc string

这是 D1 接受表的直接结果。proposal 里「描述中的 `"""` 吞掉余下文件」的问题由此消失，不需要单独处理。

### D5 非英语方言只报缺口

参考共有 80 种方言。内置全部关键字表是一张大数据表，而目前的语料与需求里都没有非英语的 `.feature`。所以只认 `start` 里的 `# language: <code>`：代码不是 `en`，就从该行到最后一个非空行记一段 `unsupported-language`，不再解析。

如果不做这一步，这类文件的每一行也都会记成 `out-of-place`。缺口照样可见，但原因说错了。

### D6 有意不实现的合法性规则

以下规则只决定文件是否合法，不改变哪些行产记录，也不会让行消失：

- tag 之后必须跟 Feature、Rule、Scenario 或 Examples 标题；
- 一个步骤的参数最多一个表格加一个 doc string，且先后顺序有限制；
- Examples 只接在 Scenario Outline 下：参考语法本身允许任何 Scenario 带 Examples，因为两者共用 `ScenarioLine` 记号。

违反这些规则的行，按 D1 落到 tag、步骤参数或 Examples 的角色里。

### D7 与 task 描述不同的一处

task 说「Scenario 描述里以 Given/When 开头的行也被误记成步骤」。参考解析器在 Scenario 与 Background 的描述状态下先试 `StepLine`，所以这种行就是步骤。读取器照参考语法记为 step，测试也钉的是这一点。

### D8 section 名

section 名沿用现状：冒号后的标题原文，空标题就是空串。`Background:` 通常没有标题，它的 section 名为空。不拿关键字补名字：结构行只记源码里有的东西。

## Oracles（编码前固定）

- **O1 解析器。** 新增测试覆盖以下各项，每一项在 origin/main 的解析器上都失败：
  1. 反引号 doc string；
  2. `'''` 不是分隔符；
  3. Feature 描述里的步骤关键字行与 `"""` 行；
  4. `Example:`、`Scenario Template:`、`Background:`、`Rule:` 与 Rule 下的层级；
  5. `*` 与 `But` 步骤；
  6. 没有 Gherkin 结构的非空文件；
  7. 步骤之后的自由文字；
  8. 未闭合的 doc string；
  9. 非英语方言；
  10. Background 步骤后的 Examples、Examples 表格后的步骤。

  验法：把 main 的 `feature-parser.ts` 临时放回，运行新测试文件，逐条确认失败，再恢复。现有 6 条测试的样例数据不变，期望照参考语法重算：样例的 `Background:` 成为一个 section，名字为空串，所以 section 由 3 个变为 4 个；步骤仍是 8 个。
- **O2 账本。** `test_coverage_ledger.test.mjs` 新增端到端用例，即 spec 场景「`.feature` 放不下的行可见」，在 main 上失败。`extract-structure-result` 的 `unplaced` 校验另有单元用例：形状不对时整个文件 `parse-failed`，与其他字段一致。
- **O3 全量门。**
  - `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`；
  - `pnpm --filter @excavator/core test`；
  - `pnpm run typecheck`；
  - `openspec validate --all --strict`。

  新文件先 `git add -N` 再跑门。
- **O4 真实产物。** 用公开语料 fineract（181 个 `.feature`）只读运行新旧解析器，按文件比对 section、step 与 `unplaced`。对每个有差异的文件，逐条确认差异来自 D1 的哪一行规则。新解析器的每一段 `unplaced` 都要人工读过，确认原文确实不合参考语法。验收记录只写计数与规则归属，不写文件内容。

## 验收记录

- **O1。** 新解析器 17 条测试全过。把 origin/main 的 `feature-parser.ts` 临时放回后，13 条失败：
  - 新增的 11 条全部失败。O1 的十项写成了 11 条测试：第 3 项分成「步骤关键字」与「`"""`」两条；
  - 改过期望的 2 条也失败，原因是 Background 成了 section；
  - 其余 4 条通过。

  恢复后逐字节比对，与提交版本一致。O1 第 5 项，`*` 步骤的测试里也有 `But` 步骤。main 上 `But` 本来就能识别，所以这条测试在 main 上失败靠的是 `*`。
- **O2。** 新增 6 条测试：结构结果行 5 条（带出且不计符号 1 条，4 种坏形状），账本端到端 1 条。用 origin/main 的三个源文件（解析器、`extract-structure-result.mjs`、`coverage-ledger.mjs`）重建 core 再跑，6 条全部失败；恢复后重建，81 条全过。
- **O3。**
  - `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`：4,111 条通过，34 条跳过，2 个文件失败，都是超时：
    - hotspots 的「reads a log that spans many pipe chunks」超过 20 秒；
    - name-references-pipeline 的 hook 超过 10 秒；
    - 另有一次 worker RPC `onTaskUpdate` 超时。

    那时机器上同时在跑别的任务。把这两个文件单独重跑，120 条全过。它们不读 `.feature`，也不经过本变更改的三个文件。
  - `pnpm --filter @excavator/core test`：1,448 条全过。
  - `pnpm run typecheck`：通过。
  - `openspec validate --all --strict`：通过。
  - PR 上 Linux 的 CI 结果以 required check 为准。
- **O4。**
  - 公开语料 fineract 与 tomee 共 184 个 `.feature`：新旧解析器的步骤逐行相同，都是 73,533 条；`unplaced` 为 0 段。
  - 另用一个私有语料（24 个 `.feature`，只读，名字不进仓库）比对：步骤相同，都是 2,234 条；`unplaced` 为 0 段。
  - 唯一的差异是新增的 section：公开语料 8 个，私有语料 13 个。逐个读过原行，都是 `Background:`，即 D1 中「Background 在 container 里落 section」这一条。
  - 两份语料里都没有描述被误记成步骤的情形，也没有放不下的行。这两类行为只由 O1 的夹具覆盖。

## Risks / Trade-offs

- **会少掉步骤。** Feature 描述里的「步骤」从此不记。原来它们是编造出来的，少掉是本意。
- **digest 会变。** 含放不下的行的项目会多一条缺口，`factsDigest` 随之变化。仓库里冻结的 digest 只来自不含 `.feature` 的夹具，由全量门确认。
- **不认非英语方言。** 这是覆盖缺口，但可见，进 roadmap，不在本变更里做。
