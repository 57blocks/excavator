## ADDED Requirements

### Requirement: 发现的优先级

全部章节核对之后，`excavator-prd-report` SHALL 由排序子代理按写死的判据给每条 finding 定 `P0`、`P1` 或 `P2`，并写一句理由，说明证据满足了哪条判据、影响到谁；证据不足以表明较高一级的判据时 SHALL 取较低一级，并在理由里说明什么不明显。判据 SHALL 原样写在 skill 里：`P0` 为能让人做不被允许的事（通过本应拦住他的认证或权限检查、读写他人数据、看到机密）、丢失或损坏已存数据、算错金额，或使功能的主流程对所有用户失败；`P1` 为在用户使用的流程里给出错误、不一致或缺失的结果，向用户或运维隐藏失败，或在普通输入下出错；`P2` 为其余缺陷。理由 MUST NOT 写修法，适用与 findings 陈述相同的建议性措辞检查。

定级 SHALL 写在每个功能的 `priorities/<id>.json`，只能由排序子代理写，主模型 MUST NOT 写或改它。脚本 SHALL 检查每个已写成功能的定级与其 findings 一一对应（每条恰好一次、没有多余 id）、级别只取三个值、理由非空且不超过 300 字符；需要排序的功能由脚本按章节顺序分批，每批 findings 合计不超过 120 条。不过检查的功能 SHALL 重派一次排序；仍不过时其 findings 记为未定级，MUST NOT 阻断 `PRD.md` 与报告页。续跑时已有合格定级的功能 SHALL NOT 重新排序。

`aggregate` SHALL 把合格的定级并进 `findings.json`（每条带 `priority` 与 `priorityReason`，未定级为 `null`），按级别（P0、P1、P2、未定级）、功能顺序、finding 序号排序，并记录每个功能与全体的各级别条数；各级别条数之和 SHALL 等于 findings 条数，不等时 `aggregate` 退出非零。

#### Scenario: 漏定一条
- **WHEN** 某功能的定级文件缺了它的一条 finding
- **THEN** `check-priorities` 退出非零并打印该功能与缺失的 finding id，该功能重派一次排序

#### Scenario: 理由写成建议
- **WHEN** 某条定级的理由含 "should" 之类的建议性措辞
- **THEN** `check-priorities` 退出非零并打印该 finding id

#### Scenario: 两次排序都不过
- **WHEN** 某功能的第二次排序仍不过检查
- **THEN** 它的定级文件被删除，它的 findings 在 `findings.json` 里级别为 `null`，计入未定级；`PRD.md` 与报告页照常写出

#### Scenario: 旧产物补定级
- **WHEN** 一个在本变更之前跑完、没有任何定级的产物目录，用同一命令再跑一次
- **THEN** 不派泳道、不重写章节，只派排序子代理并重新汇总、拼装与生成报告页

#### Scenario: 排序与守恒
- **WHEN** `aggregate` 汇总一个各级别都有 findings 的产物目录
- **THEN** `findings.json` 先列全部 P0，再 P1、P2、未定级，同一级别内按功能顺序与序号；各级别计数之和等于 findings 条数

## MODIFIED Requirements

### Requirement: 功能级发现

每条功能泳道 SHALL 产出该功能的 findings：`class` 为 `product`（用户可见的行为缺陷：不一致、缺失、不对称）或 `technical`（代码层面的问题）；每条 SHALL 有陈述、所属功能 id 与至少一条证据 `{file, passage}`。脚本 SHALL 检查每段 `passage` 在其文件里按归一化规则恰好出现一次并写回行号，检查陈述不含建议性措辞；任一不过，该功能标 `failed` 并记原因。泳道写的 findings MUST NOT 含修法、严重度或置信度；级别只由排序步骤给出（见「发现的优先级」）。汇总后的 `findings.json` 每条 SHALL 带 `feature` 与 `verdict: anchor-checked`。

#### Scenario: 引文出现两次
- **WHEN** 某条 finding 的 `passage` 在文件里出现两次
- **THEN** `check-lane` 退出非零并打印该 finding 的 id 与文件，功能标 `failed`

#### Scenario: 陈述写成建议
- **WHEN** 某条 finding 的陈述含 "should" 之类的建议性措辞
- **THEN** `check-lane` 退出非零并打印该 finding 的 id，功能标 `failed`

#### Scenario: 没有发现
- **WHEN** 泳道在范围内没有找到问题
- **THEN** `findings/<id>.json` 是空数组，功能照常进入核对

### Requirement: 写给用户的话与最后的回复

`excavator-prd-report` 运行中写给用户的每一句话（命令之间的进度说明、打印的功能清单，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、PRD、findings 的陈述、定级的理由与最后的回复 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆、系统区域设置与代码库的语言 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。

最后的回复 SHALL 只有这几行，依次为：
- 拼装出的 `PRD.md` 所在的路径；
- 报告页 `report.html` 所在的路径；
- 写成与失败的功能数、图数、findings 按类别与按级别（P0、P1、P2、未定级）的计数、核对合计；
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

### Requirement: 报告页

`excavator-prd-report` SHALL 在拼装 `PRD.md` 之后由脚本把产物目录打成一个独立的 `<out>/report.html`。页面 SHALL 只用浏览器打开即可使用：所有脚本、样式、字体与数据内联，Content-Security-Policy 禁止任何网络连接，MUST NOT 引用外部 URL。同一产物目录 SHALL 得到字节相同的页面；页面 MUST NOT 含打包时间或本机绝对路径，项目只以目录名出现。

页面 SHALL 有总览、每个功能一页、全部 findings 一页与覆盖页，用 URL 的 `#` 片段导航，在 `file://` 下可用。`index.json` 里的每个功能 SHALL 在总览与导航里出现且只出现一次，显示其状态；`failed` 的功能 SHALL 显示失败原因；没有章节文件的功能 SHALL 显示为没有章节，MUST NOT 被省略。`findings.json` 里的每条 finding SHALL 在 findings 页与它所属功能的页里各出现一次，带类别、级别（未定级时标明未定级）、定级理由、陈述与每条证据的 `文件:行` 与引文；页面 SHALL 把 findings 称为 anchor-checked，MUST NOT 称为已核对。findings 页与功能页 SHALL 按 `findings.json` 的顺序（即按级别）列出 findings；findings 页 SHALL 可按类别、级别、功能与文字筛选，筛选条件放在 URL 片段里；总览 SHALL 显示各级别的条数。

章节与总览的 Markdown SHALL 渲染为 HTML：表格、`<details>`/`<summary>` 证据块与 mermaid 图。原始 HTML SHALL 经白名单净化，只保留 Markdown 能产生的元素与 `<details>`/`<summary>`。mermaid 图渲染失败时 SHALL 显示图的源文本并标明渲染失败，MUST NOT 静默留空。页面界面文字固定英文；总览、章节、findings 与定级理由的正文按产物原样显示。

`index.json`、`findings.json` 与各功能的文件不一致（`page` 按 `aggregate` 的规则重算的结果与磁盘上的汇总产物不同，或 `findings.json` 缺失）时，`page` SHALL 退出非零并提示先运行 `aggregate`，MUST NOT 写出页面。

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

#### Scenario: 按级别筛选 findings
- **WHEN** 用户在 findings 页只选 `P0`
- **THEN** 页面只显示级别为 `P0` 的 findings，显示的条数等于 `findings.json` 里该级别的条数；URL 片段带上这个筛选，刷新后不丢

#### Scenario: 汇总过期
- **WHEN** 一个功能的文件在上次 `aggregate` 之后被改动，使重算的状态与 `index.json` 不同
- **THEN** `page` 退出非零，提示先运行 `aggregate`，不写 `report.html`

#### Scenario: 图写错了
- **WHEN** 某章节的 mermaid 代码无法解析
- **THEN** 该处显示图的源文本与「渲染失败」标记，页面其余部分照常
