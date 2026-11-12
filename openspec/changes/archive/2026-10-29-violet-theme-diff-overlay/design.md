## Context

两个页面都是「构建出的模板 + 一个内联数据块」：模板分别由 `packages/explorer` 与 `packages/prd-report-page` 构建，`/excavator-view` 与 `prd.mjs page` 只在两个标记处填入 CSP 与数据。外观改动只在模板里，数据块不变。

## Decisions

**D1 主题按颜色命名，默认紫色。** 两个预设叫 Dark Violet、Light Violet，强调色叫 Violet；颜色：深色底 `#0C0C0E`，浅色底 `#EDEDEF`，强调 `#7C5CFF`（深）/ `#6A4DFF`（浅）。界面、代码与主题名不出现公司名。默认换成 Dark Violet；浏览页「用户选过的主题优先」的既有行为不变（只在用户在主题选择里改过时才写入本地存储），所以从没选过主题的人看到新默认。代价：选过金色主题的人仍看到金色。

**D2 报告页的主题开关自己实现，不复用浏览页的主题选择。** 报告页只要两套颜色，不需要预设与强调色的组合；一个两键开关加一个本地存储键（`excavator-prd-report-theme`）足够。首次绘制前由一段内联脚本设好 `data-theme`，避免先闪浅色；CSP 已允许内联脚本。读写本地存储都包在 try/catch 里，失败时为默认。不再跟随系统明暗：浏览页本来就不跟随，两页一致比跟随系统重要。

**D3 文字对比度优先于原样取色。** 强调色直接当正文颜色时对比度不到 4.5:1，报告页另设 `--accent-text`（深色 `#A48BFF`、浅色 `#3B2DB5`）用于文字与链接，原强调色只用于填充与边框；徽标颜色同样按 4.5:1 调过。

**D4 差异覆盖层只是一个可选输入，打包不生成它。** 生成它要选一个差异范围（未提交改动、分支、一段时间的合并），这是判断题，属于 skill 或用户；本变更只规定格式与打包规则，让手写或脚本写出的文件能可靠地进页面。不在图里的 id 与两边都有的 id 计数写进原因（没有第四态）；`provenance.sourceRevision` 与快照版本不同时标 different-revision，与其它产物的做法一致。生成它的 skill 留作后续变更。

**D5 层卡片的计数按 `filePath` 归属。** 层的 `nodeIds` 通常只有文件节点，函数与类节点不在任何层里；不归属就会让大部分 changed 节点在层卡片上消失。规则：在层里就算这一层；不在任何层里时，算进含同一 `filePath` 节点的层；每层每节点只算一次。分组高亮用同一规则。

## Oracle

- 打包：`tests/skill/excavator-view/explorer-pack.test.mjs` 覆盖规格里的五个场景（included、not-run、id 不在图里与两边都有、格式错、版本不同），并确认原来那行 not-produced 不再出现在 `diff-overlay.json` 上。
- 层计数：`computeDiffLayerCounts` 的单测覆盖直接在层里、按 `filePath` 归属、已在层里的节点不再按路径重复计、未知 id 忽略；删掉按路径归属的那一行至少一个测试变红。
- 报告页主题：单测覆盖默认深色、存储往返、存储抛错、无效值忽略；CSS 不再含 `prefers-color-scheme`。
- 真实语料（go-multirepo，不进仓库）：用新代码 `--out` 到语料外重打一次浏览页，它的数据块除新增的 `diff-overlay.json` 键与清单里的这一行外，与之前的页面逐字节相同；两页在 headless Chrome 里打开无控制台错误。
