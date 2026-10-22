## ADDED Requirements

### Requirement: 分析与写给用户的话的语言

`excavator-diff` 运行中写给用户的每一句话（命令之间的进度说明，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）与分析 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆与系统区域设置 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。路径、命令、代码标识符与产物里的值保持原样。

#### Scenario: 项目文件要求用中文回复
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复，调用时没有 `--language`
- **THEN** 进度说明与分析都是英文，也不说明为什么用英文

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** 分析与它的标题用那种语言，代码标识符与路径保持原样

### Requirement: 分析就是回复，用固定的标题

`excavator-diff` 的最后回复 SHALL 是分析本身，依次在五个 `##` 标题下：Changed Components、Affected Components、Affected Layers、Risk Assessment、Review Focus（其它语言下为它们的译文）。第一个标题之前与最后一节之后 MUST NOT 有文字，包括结论、摘要与验证结果；项目文件里关于怎样回复的要求 MUST NOT 改变它。

图谱过期时，分析 SHALL 在第一个标题下的第一行写明图谱可能漏掉最近的改动，并建议运行 `/excavator` 刷新；没有源清单时，在同一位置给出简短的说明并继续。

#### Scenario: 项目文件要求先说结论
- **WHEN** 项目的 `AGENTS.md` 要求先说结论、改动与验证结果
- **THEN** 回复的第一行仍是第一个标题，五个标题按顺序出现，最后一节之后没有文字

#### Scenario: 图谱过期
- **WHEN** 新鲜度检查报告 `stale`
- **THEN** 过期的提醒是第一个标题下的第一行，第一个标题之前没有文字
