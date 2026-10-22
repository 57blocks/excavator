## ADDED Requirements

### Requirement: 解释与写给用户的话的语言

`excavator-explain` 运行中写给用户的每一句话（命令之间的进度说明，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）与解释 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆与系统区域设置 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。路径、命令、代码标识符与产物里的值保持原样。查找组件时 SHALL 去掉 `--language` 与它的值。

#### Scenario: 项目文件要求用中文回复
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复，调用时没有 `--language`
- **THEN** 进度说明与解释都是英文，也不说明为什么用英文

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** 解释与它的标题用那种语言，代码标识符与路径保持原样

### Requirement: 解释写进数据目录，由最后一条命令打印成回复

`excavator-explain` SHALL 把解释写到 `.excavator/explanation.md`，依次在五个 `##` 标题下：Role、Internal Structure、External Connections、Data Flow、Worth Knowing（其它语言下为它们的译文）；文件以第一个标题开头、以最后一节结尾。最后的回复 SHALL 是最后一条命令打印出的这个文件，此外 MUST NOT 有文字，包括结论、摘要与验证结果；项目文件里关于怎样回复的要求 MUST NOT 改变它。

图谱过期时，解释 SHALL 在第一个标题下的第一行写明图谱来的内容可能漏掉最近的改动，并建议运行 `/excavator` 刷新；没有源清单时，在同一位置给出简短的说明并继续。

#### Scenario: 项目文件要求先说结论
- **WHEN** 项目的 `AGENTS.md` 要求先说结论、改动与验证结果
- **THEN** 回复与最后一条命令打印的解释逐行相同，第一行是第一个标题，五个标题按顺序出现

#### Scenario: 图谱过期
- **WHEN** 新鲜度检查报告 `stale`
- **THEN** 过期的提醒是第一个标题下的第一行，第一个标题之前没有文字
