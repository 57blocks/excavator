## ADDED Requirements

### Requirement: 报告页

`excavator-prd-report` SHALL 在拼装 `PRD.md` 之后由脚本把产物目录打成一个独立的 `<out>/report.html`。页面 SHALL 只用浏览器打开即可使用：所有脚本、样式、字体与数据内联，Content-Security-Policy 禁止任何网络连接，MUST NOT 引用外部 URL。同一产物目录 SHALL 得到字节相同的页面；页面 MUST NOT 含打包时间或本机绝对路径，项目只以目录名出现。

页面 SHALL 有总览、每个功能一页、全部 findings 一页与覆盖页，用 URL 的 `#` 片段导航，在 `file://` 下可用。`index.json` 里的每个功能 SHALL 在总览与导航里出现且只出现一次，显示其状态；`failed` 的功能 SHALL 显示失败原因；没有章节文件的功能 SHALL 显示为没有章节，MUST NOT 被省略。`findings.json` 里的每条 finding SHALL 在 findings 页与它所属功能的页里各出现一次，带类别、陈述与每条证据的 `文件:行` 与引文；页面 SHALL 把 findings 称为 anchor-checked，MUST NOT 称为已核对。

章节与总览的 Markdown SHALL 渲染为 HTML：表格、`<details>`/`<summary>` 证据块与 mermaid 图。原始 HTML SHALL 经白名单净化，只保留 Markdown 能产生的元素与 `<details>`/`<summary>`。mermaid 图渲染失败时 SHALL 显示图的源文本并标明渲染失败，MUST NOT 静默留空。页面界面文字固定英文；总览、章节与 findings 的正文按产物原样显示。

`index.json`、`findings.json` 与各功能的文件不一致（`page` 按 `aggregate` 的规则重算的状态与 `index.json` 记录的不同，或 `findings.json` 缺失）时，`page` SHALL 退出非零并提示先运行 `aggregate`，MUST NOT 写出页面。

#### Scenario: 双击打开
- **WHEN** 用户在没有网络的机器上双击 `report.html`
- **THEN** 总览、功能页、findings 页与覆盖页都能打开，mermaid 图显示为图，浏览器控制台没有 CSP 违例与错误

#### Scenario: 重复生成
- **WHEN** 对同一产物目录执行两次 `page`
- **THEN** 两次的 `report.html` 字节相同

#### Scenario: 有失败的功能
- **WHEN** 某功能的状态是 `failed`
- **THEN** 它出现在总览的功能列表与导航里，显示 `failed` 与失败原因；它的功能页说明没有章节

#### Scenario: 按类别筛选 findings
- **WHEN** 用户在 findings 页只选 `product`
- **THEN** 页面只显示 `class` 为 `product` 的 findings，显示的条数等于 `findings.json` 里该类别的条数

#### Scenario: 汇总过期
- **WHEN** 一个功能的文件在上次 `aggregate` 之后被改动，使重算的状态与 `index.json` 不同
- **THEN** `page` 退出非零，提示先运行 `aggregate`，不写 `report.html`

#### Scenario: 图写错了
- **WHEN** 某章节的 mermaid 代码无法解析
- **THEN** 该处显示图的源文本与「渲染失败」标记，页面其余部分照常

## MODIFIED Requirements

### Requirement: 写给用户的话与最后的回复

`excavator-prd-report` 运行中写给用户的每一句话（命令之间的进度说明、打印的功能清单，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、PRD、findings 的陈述与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆、系统区域设置与代码库的语言 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。

最后的回复 SHALL 只有这几行，依次为：
- 拼装出的 `PRD.md` 所在的路径；
- 报告页 `report.html` 所在的路径；
- 写成与失败的功能数、图数、findings 按类别的计数、核对合计；
- 没有模式的框架（为空时没有这一行）；
- 保存进项目的提议。PRD 已在用户给出的路径上时，没有这一行。

这些数字 SHALL 来自 `aggregate` 打印的字段，MUST NOT 由模型相加。回复 MUST NOT 有这几行之外的文字，包括摘要、结论与对核对结果的挑选。项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它。换了语言时，这几行的文字译成那种语言，路径与数字保持原样。

保存进项目 SHALL 仍是提议：用户同意之前，skill MUST NOT 把 PRD 写进 `--out` 之外的项目路径。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 打印的功能清单、进度说明、PRD、findings 与最后的回复都是英文，也不说明为什么用英文；最后的回复只有 PRD 路径、报告页路径、计数行、缺模式框架行与保存的提议

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** PRD 与 findings 的陈述用那种语言，最后回复的几行文字也译成那种语言，路径与数字保持原样

#### Scenario: 用户没有给出保存路径
- **WHEN** 调用没有给出 PRD 的保存路径
- **THEN** PRD 留在 `--out` 下，回复的最后一行提议保存进项目的默认路径，skill 不自行写进项目

### Requirement: 产物目录与单文件拼装

`excavator-prd-report` 的产物 SHALL 是一个目录：`index.json`、`overview.md`、`features/`、`findings/`、`verification/`、`tables/`、`findings.json`、拼装出的 `PRD.md` 与报告页 `report.html`。`PRD.md` SHALL 由脚本按 `chapter` 顺序拼装总览、脚本生成的表、各功能章节与附录（覆盖表、核对表、失败的功能及原因），同一输入 SHALL 得到字节相同的输出；表格 MUST NOT 由模型转写。脚本生成的表、附录标题与其中的固定词 SHALL 为英文，与 `--language` 无关；模型写的总览、章节与 findings 陈述跟随 `--language`。

#### Scenario: 重复拼装
- **WHEN** 对同一产物目录执行两次 `assemble`
- **THEN** 两次 `PRD.md` 字节相同

#### Scenario: 有失败的功能
- **WHEN** 某功能的状态是 `failed`
- **THEN** `PRD.md` 的附录列出它的 id、名称与失败原因，正文没有它的章节
