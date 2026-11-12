## Why

`explorer.html` 已经是项目的主浏览页，但 unused-code、hotspots、doc-map 三个产物只能在旧的 `view.html` 里看。用户要求：
- 在浏览页里按它现有的样式显示 Unused、Hotspots、Doc map；
- 去掉顶栏的 Files | Classes 切换和后面的节点类型过滤（Code、Config 等），把这三个入口放在原来的位置；
- 点开后在中间区域显示该产物的数据，风格与浏览页一致；
- 去掉首次打开时的「Welcome to the knowledge graph」引导弹窗。

这是让 `view.html` 退役的第一步：三个产物页有了新家之后，旧查看器只剩 Reports 与 Products 页没有对应。

## What Changes

- **顶栏**：去掉 Files | Classes 切换（连同类视图里的函数开关）和节点类型过滤标签；结构图固定为文件级、显示全部节点类型。原位置放三个按钮 Unused、Hotspots、Doc map，样式同 Domain | Structural 的分段按钮。
- **产物视图**：点一个按钮，中间区域换成该产物的视图；再点同一个按钮或点 Domain / Structural 回到图，图的位置与选中不丢。视图内容与 `view.html` 的三个产物页相同（统计、分布、可筛选可排序的表、判定与残余假设等），版式用浏览页自己的颜色、字体与卡片。
- **行详情**：点表中一行，右侧栏显示这一行的详情（unused 的信号、分组与引用者，hotspots 的逐年提交与同改文件，doc-map 的引文、证据与核验结论），带「在图中显示」与「打开代码」。
- **产物状态**：产物没跑、读不了或与打包的源码版本不同时，视图写明，并给出对应命令或两个版本；不编数据补齐。
- **引导弹窗**：不再显示。
- **打包**：`explorer.html` 的数据里加入这三个产物（及 doc-map 的核验记录）的原文和各自的状态。

不在本变更里：`view.html` 的退役、Reports 与 Products 页、节点详情里的产物事实（viewer-learn 第 5 片）。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `report-viewer`：离线浏览页新增 Unused、Hotspots、Doc map 三个视图与行详情；顶栏去掉文件与类切换和节点类型过滤；去掉引导弹窗。

## Impact

- **代码：** `packages/explorer/src` 的顶栏、移动端抽屉、主区域与侧栏，新增三个产物视图；`skills/excavator-view/explorer-data.mjs` 加入三个产物的数据与状态。
- **测试：** 打包单测、浏览页单测、`scripts/explorer-smoke.mjs` 冒烟夹具加三个产物。
- **体积：** `explorer.html` 多出三个产物的原文（与 `view.html` 内嵌的相同）。
