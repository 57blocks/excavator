## MODIFIED Requirements

### Requirement: 面向读者、可读、正文无代码

`excavator-prd` SHALL 用 `--role`（默认产品经理）的产品语言写作，`--language` 决定输出语言，没有指定时用英文。正文 MUST NOT 出现代码、签名、SQL 或配置字面量；数字枚举/状态码/字段值 SHALL 翻译为人类含义，码表只进字段字典表。证据（`file:line`）SHALL 放入可折叠区而非正文，并 SHALL 使用表格/列表/mermaid 提升可读性。

#### Scenario: 枚举翻译
- **WHEN** 某状态在源码中是数字码（如 `status=2`）
- **THEN** PRD 正文以其含义呈现（如「已完成」），裸码不出现在叙述中

#### Scenario: 图与证据
- **WHEN** 描述一条跨层流程
- **THEN** PRD 提供对应的 mermaid 图，并把该流程的 `file:line` 证据折叠在 `<details>` 中

## ADDED Requirements

### Requirement: 写给用户的话与最后的回复

`excavator-prd` 运行中写给用户的每一句话（命令之间的进度说明、打印的流程清单与大纲，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、PRD 与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆、系统区域设置与代码库的语言 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。

最后的回复 SHALL 只有这几行，依次为：
- PRD 所在的路径；
- 覆盖、图、术语与核对四项自检的计数；
- 保存进项目的提议。PRD 已在用户给出的路径上时，没有这一行。

回复 MUST NOT 有这几行之外的文字，包括摘要、结论与对核对结果的挑选。项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。换了语言时，这几行的文字译成那种语言，路径与数字保持原样。

保存进项目 SHALL 仍是提议：用户同意之前，skill MUST NOT 把 PRD 写进项目。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 打印的流程清单、大纲、进度说明、PRD 与最后的回复都是英文，也不说明为什么用英文；最后的回复只有路径、四项计数与保存的提议

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** PRD 用那种语言，最后回复的几行文字也译成那种语言，路径与数字保持原样

#### Scenario: 用户没有给出保存路径
- **WHEN** 调用没有给出 PRD 的保存路径
- **THEN** PRD 留在第 5 步写下的位置，回复的最后一行提议保存进项目的默认路径，skill 不自行写进项目
