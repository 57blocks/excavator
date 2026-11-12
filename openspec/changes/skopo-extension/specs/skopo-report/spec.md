## ADDED Requirements

### Requirement: 总结每处都可追到 statement

`skopo-report` SHALL 要求一个已收尾的 skopository（`run.json` 有结束时间），否则告诉用户先跑 `skopo-create` 并结束。模型 SHALL 写 `$OUT/report/summary.md`：第一行是 `#` 标题，其余写系统的目的、消费方与产品、各域的要点与原则、最该先看的问题为什么重要。脚本 SHALL 核对：每个段落、列表项与表格数据行至少引用一个 statement ID；每个被引用的 ID 在 skopository 里存在且种类一致；没有占位 ID；没有脚本拥有的小节标题。任一项不成立时 SHALL 退出 1 并逐条打印位置与原因。

#### Scenario: 没有引用的段落
- **WHEN** summary 有一段话没有引用任何 statement ID
- **THEN** 检查退出 1，打印该段所在行

#### Scenario: 种类不符
- **WHEN** summary 引用 `R-` 开头的一个 ID，而 skopository 里同一个键是一条 term
- **THEN** 检查退出 1，打印这个 ID 与它在 skopository 里的种类

### Requirement: 问题与覆盖由脚本守恒地生成

`report.md` SHALL 由脚本拼成：summary，然后依次是 `## Status`、`## Questions`、`## Decisions without a recorded reason`、`## Scope and coverage`。`## Questions` SHALL 包含 `questions.md` 表格的每一行且只出现一次，按后果排序（security、money、regulation、promise、behaviour、documentation），同类内保持原编号顺序；类别不在这六个之中时 SHALL 退出 1。`## Status` SHALL 写明 skopository 是否已 lock；没有 lock 时 SHALL 写明它是未经人确认的提案。

#### Scenario: 问题守恒
- **WHEN** `questions.md` 有 12 行问题
- **THEN** `report.md` 的问题表恰好 12 行，security 类在最前

#### Scenario: 未 lock
- **WHEN** skopository 没有 `spec.lock.json`
- **THEN** `## Status` 写明这是未经人确认的提案

### Requirement: 报告页不执行也不链接任何内容

`report.html` SHALL 是一个不引用外部资源、可从磁盘打开的文件。脚本 SHALL 先转义全部文本，再只套用标题、段落、列表、表格、粗体、行内代码与代码块；MUST NOT 生成链接、原始 HTML 或脚本。

#### Scenario: 模型写了脚本与链接
- **WHEN** summary 含 `<script>alert(1)</script>` 与 `[x](javascript:alert(1))`
- **THEN** 页面把它们显示为文本，页面里没有 `<script` 与 `<a`
