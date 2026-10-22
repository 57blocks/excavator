## MODIFIED Requirements

### Requirement: Feature/Scenario/步骤抽成带锚点结构

parser SHALL 按 Gherkin 参考语法的英文关键字识别标题行与步骤行。识别前先去掉行首空白。

- 标题行：`Feature`/`Business Need`/`Ability`、`Rule`、`Background`、`Scenario`/`Example`、`Scenario Outline`/`Scenario Template`、`Examples`/`Scenarios`，关键字后紧跟冒号。
- 步骤行：`Given`/`When`/`Then`/`And`/`But`/`*`，关键字后跟一个空格。

以下标题落 `sections`，`name` 为冒号后的标题原文，带 `lineRange`：

| 标题 | 放在哪里才落 section | level |
|---|---|---|
| Feature | 文件里第一个标题 | 1 |
| Rule | Feature 之后任意处 | 2 |
| Background | Feature 或 Rule 的描述里，在它的第一个 Scenario 或 Rule 之前 | Rule 之下为 3，否则为 2 |
| Scenario、Scenario Outline | Feature 之后任意处 | Rule 之下为 3，否则为 2 |

步骤行 SHALL 只在 Background 或 Scenario（含 Outline）之下落 `steps`：`name` 为去掉首尾空白的原行，带 `lineRange`。

以下行 MUST NOT 产记录：注释、空行、tag、Examples 标题、表格行、doc string 的分隔符与内容、描述文字。

#### Scenario: 场景与步骤各归其位
- **WHEN** `.feature` 含一个 Feature、两个 Scenario、若干 Given/When/Then
- **THEN** Feature 与两个 Scenario 落 sections，每个步骤落一条 step，行号命中

#### Scenario: 步骤原文保真
- **WHEN** 某步骤为 `When the user taps "Pair App"`
- **THEN** 对应 step 的 name 与原文一致

#### Scenario: 同义关键字、Rule 与 Background 落 section
- **WHEN** `.feature` 的 Feature 下有一个 `Rule:`，Rule 下依次是 `Background:`、`Example:` 与 `Scenario Template:`
- **THEN** 这四个标题都落 section：Rule 的 level 为 2，其余三个为 3

#### Scenario: `*` 与 `But` 步骤
- **WHEN** 某 Scenario 下有 `* the app is open` 与 `But no dialog is shown`
- **THEN** 这两行各落一条 step

## ADDED Requirements

### Requirement: 描述文字不成结构

描述是指 Feature、Rule、Background、Scenario 或 Examples 标题之后的自由文字，止于该标题下第一个被接受的标题、步骤或表格行。描述里的行按参考语法放置：

- 参考语法在该位置接受的标题或步骤，照它的规则落记录。
- 其余的行都是描述文字，MUST NOT 产记录，也 MUST NOT 打开 doc string。包括：
  - Feature、Rule 与 Examples 描述里以步骤关键字开头的行；
  - 任何描述里的 doc string 分隔符与表格行；
  - Background 或 Scenario 描述里的 `Background:` 与 `Feature:` 行。

#### Scenario: Feature 描述里的步骤关键字
- **WHEN** Feature 描述里有一行 `Given a manager signs in, the list loads`
- **THEN** 这一行不产 step

#### Scenario: 描述里的分隔符不吞后文
- **WHEN** Feature 描述里有一行以 `"""` 开头，其后文件还有一个 Scenario 与它的步骤
- **THEN** 该 Scenario 与它的步骤照常落记录，且 `unplaced` 为空

### Requirement: doc string 按参考分隔符跳过

doc string SHALL 只在步骤或步骤的表格之后打开。去掉行首空白后以 `"""` 或三个反引号开头的行是分隔符，同一个分隔符关闭它。doc string 的内容 MUST NOT 产记录。`'''` 不是分隔符。

#### Scenario: 反引号 doc string
- **WHEN** 步骤之后有一个三反引号的 doc string，内容里有 `Scenario:` 行与 `Given` 行
- **THEN** 内容里的行不产 section，也不产 step

#### Scenario: 三个单引号不是分隔符
- **WHEN** 步骤之后有一行 `'''`，再往后有一个步骤
- **THEN** 后面那个步骤照常落 step，`'''` 那一行记入 `unplaced`

### Requirement: 放不下的行记为缺口

parser SHALL 把放不下的行记入 `unplaced`，每段带 `reason` 与 `lineRange`，这些行不产 section 或 step：

- 参考语法在该位置拒绝的行，原因为 `out-of-place`。包括：
  - Feature 之前除空行、注释、tag 之外的行；
  - Background 或 Scenario 的步骤（含其参数）之后的以下行：既不是步骤、表格行、doc string，也不是 tag、注释或空行，也不是 Scenario 或 Rule 标题，在 Scenario 中也不是 Examples 标题；
  - Examples 表格行之后的以下行：既不是表格行、tag、注释或空行，也不是 Examples、Scenario 或 Rule 标题。

  相邻的这类行合并为一段。
- 未闭合的 doc string，原因为 `unclosed-doc-string`：从开分隔符到文件最后一个非空行记一段，段内的行不产记录。
- Feature 之前不是 `en` 的 `# language:` 头，原因为 `unsupported-language`：从该行到文件最后一个非空行记一段，整个文件不产记录。

只有 `unplaced`、没有 section 与 step 的文件，状态仍为 `zero-symbol`。

#### Scenario: 没有 Gherkin 结构的非空文件
- **WHEN** 一个 `.feature` 文件只有三行连续的散文，没有任何标题
- **THEN** 它不产 section 与 step，`unplaced` 为一段 `out-of-place`，覆盖第 1–3 行

#### Scenario: 步骤之后的自由文字
- **WHEN** 某 Scenario 的步骤之后有一行不以任何关键字开头的文字，再往后是另一个步骤
- **THEN** 那一行记为一段 `out-of-place`，两个步骤都落 step

#### Scenario: 未闭合的 doc string
- **WHEN** 某步骤之后打开的 doc string 直到文件结尾都没有关闭，其后还有 `Scenario:` 行
- **THEN** 从开分隔符到最后一个非空行记一段 `unclosed-doc-string`，其后的 `Scenario:` 不落 section

#### Scenario: 非英语方言
- **WHEN** 文件第一行是 `# language: fr`
- **THEN** 不产 section 与 step，`unplaced` 为从第 1 行到最后一个非空行的一段 `unsupported-language`
