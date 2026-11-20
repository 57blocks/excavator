## ADDED Requirements

### Requirement: 查看页译名是表现层

`/excavator-view --language` 写出的翻译表 SHALL 只属于它旁边的页面，不是持久化语义。Chat、MCP 工具、检索、语义核验与任何分析步骤 MUST NOT 读取翻译表，也 MUST NOT 把译文写进语义缓存、语义图、领域图或事实图。规范语义的唯一语言仍是英文；译文只能从英文译出，MUST NOT 反过来替换或校正英文原文。

#### Scenario: 检索不读译文
- **WHEN** 项目里有 `view-translations/zh.json`，用户用中文向 Chat 提问
- **THEN** Chat 照旧把问题转成英文检索表达，检索英文规范语义与源码，不读翻译表

#### Scenario: 删掉翻译表不影响分析
- **WHEN** 删除 `view-translations/` 后运行 `/excavator` 或 Chat
- **THEN** 分析与回答的结果与翻译表存在时相同；只有下一次带 `--language` 的导出会重新翻译
