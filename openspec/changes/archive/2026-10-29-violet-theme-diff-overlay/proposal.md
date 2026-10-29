## Why

浏览页（`explorer.html`）副本带着上游的差异覆盖层：Diff 开关、changed / affected 节点的标记都已接好，但打包从不写它读的 `diff-overlay.json`，开关永远不可用。即使有了数据，结构图顶层的层卡片也不显示差异，在几百个文件的层里很难找到被标出的节点。

报告页（`report.html`）与浏览页是同一产品的两个页面，却用另一套颜色、字体与卡片，并跟随系统明暗。用户要求两页外观一致，并加一套按颜色命名的紫色主题。

## What Changes

- 浏览页增加 Dark Violet 与 Light Violet 两个预设和 Violet 强调色，默认 Dark Violet；仪表盘写死的金色强调改为跟随强调色。
- 打包读取可选的 `.excavator/diff-overlay.json`，按「差异覆盖层」的规则校验后放进页面数据，打包结果给它一个可见状态（included、not-run、unreadable、unused、different-revision），不在图里的 id 计数而不静默丢弃。
- 浏览页显示差异覆盖层的范围说明，结构图顶层的层卡片显示每层的 changed / affected 数，没有差异的层变暗，层内含差异节点的分组首次显示就高亮。
- 报告页改用浏览页的字体、颜色与卡片样式，默认 Dark Violet，提供 Dark Violet / Light Violet 开关并记住选择，mermaid 图随主题重绘。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `report-viewer`：「离线仪表盘」允许主题与差异覆盖层的改动；新增「差异覆盖层」。
- `prd-report`：「报告页」规定与浏览页同一外观和主题开关。

## Impact

- 代码：`packages/explorer`（主题、Diff 开关、层卡片、分组高亮）、`packages/prd-report-page`（样式、主题开关、字体）、`skills/excavator-view/explorer-data.mjs`（读 `diff-overlay.json`）与它们的测试。
- 依赖：报告页声明 `@fontsource/dm-serif-display@5.3.0`（浏览页已在用的同一版本）。
- 不改任何分析产物的格式或内容；已有页面的数据块不变。没有 skill 写 `diff-overlay.json`，生成它不在本变更范围内。
