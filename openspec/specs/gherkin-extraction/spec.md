# gherkin-extraction Specification

## Purpose
让 `.feature`（SpecFlow / Gherkin）从 `no-extractor` 变成带锚点事实：`Feature`/`Scenario` 落 `sections`、步骤落 `steps`，作为移动端文档「Description of the UI / 行为流程」章节的证据源。

## Requirements

### Requirement: .feature 被识别并分发到 Gherkin parser

系统 SHALL 为 `.feature` 注册语言 id `feature`，使其分发到专用 Gherkin parser 而非 `no-extractor`。

#### Scenario: .feature 映射到 feature 语言与 parser
- **WHEN** 对一个 `.feature` 文件取语言与 plugin
- **THEN** 语言 id 为 `feature` 且存在处理它的 parser（非 null）

### Requirement: Feature/Scenario/步骤抽成带锚点结构

parser SHALL 把 `Feature` 与每个 `Scenario`/`Scenario Outline` 抽成 `sections`（含 `name`、`level`、`lineRange`），把每行 `Given/When/Then/And/But` 抽成 `steps`（`name` 为步骤原文、带 `lineRange`）。注释与空行 MUST NOT 产记录。

#### Scenario: 场景与步骤各归其位
- **WHEN** `.feature` 含一个 Feature、两个 Scenario、若干 Given/When/Then
- **THEN** Feature 与两个 Scenario 落 sections，每个步骤落一条 step，行号命中

#### Scenario: 步骤原文保真
- **WHEN** 某步骤为 `When the user taps "Pair App"`
- **THEN** 对应 step 的 name 与原文一致

### Requirement: 确定性

对同一 `.feature` 内容重复运行，输出 SHALL 逐字节相同。

#### Scenario: 重复运行稳定
- **WHEN** 对同一内容运行两次
- **THEN** 两次 `sections` 与 `steps` 逐字节相同
