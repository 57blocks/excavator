## Why

`.feature` 读取器把一些不是步骤的行记成步骤，又把一些结构静默丢掉。评审器在 review-eval 里报出了这些问题，它们至今仍在 main 上：

- doc string 的分隔符认成 `"""` 与 `'''`，而 Gherkin 的分隔符是 `"""` 与三个反引号。反引号 doc string 里的行会变成步骤和场景。
- Feature 描述里以 `"""` 开头的一行会打开一个永远不关闭的 doc string，于是文件余下的内容全部消失，而文件仍报 `parsed`。
- Feature 描述里以 Given/When/Then/And/But 开头的自由文字被记成步骤，这是编造出来的结构。步骤会变成事实图里的 `pipeline` 节点。
- `Example:`、`Scenario Template:`、`Background:`、`Rule:` 与 `*` 步骤被丢掉，没有任何缺口。

零编造是硬指标，而静默丢弃就是规则禁止的「第四态」。

## What Changes

- 读取器按 Gherkin 参考语法放置每一行。参考语法指 cucumber/gherkin 的 `gherkin.berp`，以及由它生成的解析器在各个状态下接受的记号。
  - 关键字取英文方言的全集：
    - 标题：`Feature`/`Business Need`/`Ability`、`Rule`、`Background`、`Scenario`/`Example`、`Scenario Outline`/`Scenario Template`、`Examples`/`Scenarios`；
    - 步骤：`Given`/`When`/`Then`/`And`/`But`/`*`。
  - doc string 的分隔符是 `"""` 与三个反引号，只在步骤之后打开。描述里的分隔符只是描述文字。
  - 步骤只在 Background 与 Scenario（含 Outline）之下记录。在 Feature、Rule、Examples 的描述里，以步骤关键字开头的行是描述文字，不产记录。
  - Rule 与 Background 落 section。Rule 之下的 Background 与 Scenario 层级为 3。
- 有三类行不产 section 或 step，而是记入新的可选字段 `unplaced`，每条带行范围与原因：
  - 参考语法在该位置拒绝的行；
  - 没有闭合的 doc string；
  - Feature 之前声明的非英语 `# language:` 头。
- 结构结果行带上 `unplaced`。覆盖账本按语言把它们汇总成缺口 `unplaced-lines`，计行数，附样本。
- 不做以下几件事：
  - 不内置非英语方言的关键字表，这类文件只报缺口；
  - 不实现只关乎文件是否合法、不改变产出哪些记录的规则，例如 tag 之后必须跟标题，或一个步骤的参数里表格与 doc string 的先后顺序。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `gherkin-extraction`：
  - 关键字与放置规则按参考语法；
  - 描述文字不产记录；
  - doc string 只按参考分隔符、只在步骤之后打开；
  - 放不下的行记入 `unplaced`。
- `coverage-ledger`：结构结果行带上 `unplaced`，账本产出缺口 `unplaced-lines`。

## Impact

- 改动的代码：
  - `packages/core/src/plugins/parsers/feature-parser.ts` 及其测试；
  - `packages/core/src/types.ts`：新增可选字段 `StructuralAnalysis.unplaced`；
  - `skills/excavator/extract-structure-result.mjs`：校验并带出 `unplaced`。它不计入符号数，所以只有放不下的行的文件仍是 `zero-symbol`；
  - `skills/excavator/coverage-ledger.mjs` 及其端到端测试。
- 对产物的影响：
  - 含 `Example:`、`Rule:`、`Background:`、`*` 的项目会多出 section 与 step；
  - 描述被误记成步骤的项目会少掉编造的 step；
  - 含放不下的行的项目，图里会多一条缺口；
  - 这些项目的 `factsDigest` 随之变化。
- 不改其他读取器，不改事实图怎样消费 `steps`。
