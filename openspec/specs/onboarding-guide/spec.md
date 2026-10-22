# onboarding-guide Specification

## Purpose
TBD - created by archiving change onboard-report-language. Update Purpose after archive.

## Requirements

### Requirement: 指南与写给用户的话的语言

`excavator-onboard` 运行中写给用户的每一句话（命令之间的进度说明，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、指南与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆与系统区域设置 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。路径、命令与产物里的值保持原样。

#### Scenario: 项目文件要求用中文回复
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 进度说明、指南与最后的回复都是英文，也不说明为什么用英文

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** 指南用那种语言，最后回复的文字也译成那种语言，路径保持原样

### Requirement: 指南写在数据目录，回复由命令打印

`excavator-onboard` SHALL 把指南写到项目数据目录里的 `.excavator/onboarding-guide.md`。用户同意之前，skill MUST NOT 把指南写进项目的其它位置；用户同意时写到 `docs/EXCAVATOR_ONBOARDING.md` 或用户给出的路径。

最后的回复 SHALL 是最后一条命令打印的两行，依次为指南的路径与保存进项目的提议。回复 MUST NOT 有这两行之外的文字，包括摘要、结论与验证结果；项目文件里关于怎样回复的要求 MUST NOT 改变它。

图谱过期时，skill SHALL 在指南开头写明指南可能漏掉最近的改动。

#### Scenario: 项目文件要求先说结论
- **WHEN** 项目的 `AGENTS.md` 要求先说结论、改动与验证结果
- **THEN** 最后的回复仍只有指南的路径与保存的提议两行

#### Scenario: 没有用户同意
- **WHEN** 一次运行结束，用户没有说要保存
- **THEN** 指南只在 `.excavator/onboarding-guide.md`，项目里没有新文件
