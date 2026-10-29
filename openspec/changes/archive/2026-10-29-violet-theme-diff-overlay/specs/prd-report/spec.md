## MODIFIED Requirements

### Requirement: 报告页

`excavator-prd-report` SHALL 在拼装 `PRD.md` 之后由脚本把产物目录打成一个独立的 `<out>/report.html`。页面 SHALL 只用浏览器打开即可使用：所有脚本、样式、字体与数据内联，Content-Security-Policy 禁止任何网络连接，MUST NOT 引用外部 URL。同一产物目录 SHALL 得到字节相同的页面；页面 MUST NOT 含打包时间或本机绝对路径，项目只以目录名出现。

页面 SHALL 有总览、每个功能一页、全部 findings 一页与覆盖页，用 URL 的 `#` 片段导航，在 `file://` 下可用。总览 SHALL 在 `overview.md` 之后依次显示术语表、流程索引（每行链接到所属功能的页）、角色两张表与汇集的待确认项，内容与 `PRD.md` 的对应小节相同；功能页 SHALL 显示该功能的参与者与权限角色，正文不含已汇集的待确认项小节。`index.json` 里的每个功能 SHALL 在总览与导航里出现且只出现一次，显示其状态；`failed` 的功能 SHALL 显示失败原因；没有章节文件的功能 SHALL 显示为没有章节，MUST NOT 被省略。`findings.json` 里的每条 finding SHALL 在 findings 页与它所属功能的页里各出现一次，带类别、级别（未定级时标明未定级）、定级理由、陈述与每条证据的 `文件:行` 与引文；页面 SHALL 把 findings 称为 anchor-checked，MUST NOT 称为已核对。findings 页与功能页 SHALL 按 `findings.json` 的顺序（即按级别）列出 findings；findings 页 SHALL 可按类别、级别、功能与文字筛选，筛选条件放在 URL 片段里；总览 SHALL 显示各级别的条数。

章节与总览的 Markdown SHALL 渲染为 HTML：表格、`<details>`/`<summary>` 证据块与 mermaid 图。原始 HTML SHALL 经白名单净化，只保留 Markdown 能产生的元素与 `<details>`/`<summary>`。mermaid 图渲染失败时 SHALL 显示图的源文本并标明渲染失败，MUST NOT 静默留空。页面界面文字固定英文；总览、章节、findings 与定级理由的正文按产物原样显示。

页面 SHALL 与 `/excavator-view` 的浏览页同一外观：同样的字体（标题用衬线体，正文 Inter，编号与代码等宽体，全部内联）、同样按颜色命名的 Dark Violet 与 Light Violet 两套颜色与卡片样式，边框与高光颜色按浏览页的规则由强调色导出。默认 Dark Violet，不跟随系统的明暗设置；页面提供在两者之间切换的开关（窄屏时也可达），选择记在浏览器的本地存储里，读写失败时页面照常可用、退回默认；切换后 mermaid 图按新主题重绘。界面与主题名 MUST NOT 出现公司名。页面字节仍只由产物目录决定，主题选择不写进页面。

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

#### Scenario: 切换主题
- **WHEN** 用户第一次打开 `report.html`，点主题开关的 Light Violet，再刷新页面
- **THEN** 第一次打开是 Dark Violet；切换后页面与 mermaid 图都换成 Light Violet；刷新后仍是 Light Violet；浏览器禁止本地存储时页面照常显示 Dark Violet

#### Scenario: 从流程索引打开功能
- **WHEN** 用户在总览的流程索引里点一个流程
- **THEN** 页面打开该流程所属功能的页，片段路由不被章节标题锚点打断
