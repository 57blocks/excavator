## Context

`explorer.html` 是上游仪表盘的副本。顶栏左边是 Domain | Structural 模式切换，中间是 Unused | Hotspots | Doc map 产物按钮。产物视图盖在图上面，`viewMode` 在视图打开期间保持原值，所以模式按钮按 `viewMode` 高亮时会和产物按钮同时亮。

## Decisions

### D1 高亮跟着中间区域走
模式按钮的高亮条件改为「没有打开的产物视图且 `viewMode` 是这个模式」。点模式按钮的行为不变（`setViewMode` 已经处理：点切换前所在的模式只关视图并保留选中，点另一个模式则切换）。aria-pressed 跟高亮一致。

### D2 产物按钮只开不关
`toggleProductView` 换成只打开：点的是已经打开的视图时什么也不改（`productRow` 也保留，行详情不关）。三个产物按钮是同一个控件，按同一规则处理，不只改 Unused。离开视图的入口是模式按钮与 Esc，两者都已存在。

### D3 默认视角与模式
store 的初始 `persona` 改为 `non-technical`（界面上叫 Overview）。默认模式：`setDomainGraph` 在领域图第一次到达、当前模式还是 `structural` 时改成 `domain`。领域图到达之前模式按钮不显示，用户没有机会先选 Structural，所以不需要「用户是否选过」的标记；知识图（`knowledge` 模式）不是 `structural`，不受影响；`setGraph` 已有「领域图已加载就保留 domain」的逻辑，两个文件谁先到都得到 Domain。

### D4 主题存储键
存储键从副本的 `ua-theme` 改为 `excavator-explorer-theme`（与报告页的 `excavator-prd-report-theme` 同一命名）。代价：在本页面选过主题的用户要重新选一次。不迁移旧键：旧键里的值无法区分是用户选的还是 Light Violet 成为默认之前留下的，也可能是另一个副本页面在同一个 file:// 源下存的，迁移会把要去掉的那个值带过来。

### D5 Diff 默认关闭
`setDiffOverlay` 载入差异覆盖层时不再打开 `diffMode`，只记下节点集合、`label` 与 `description`；开关照常可用（它按 changed 是否为空判断），点开后的显示不变。`clearDiffOverlay` 与 `toggleDiffMode` 不动。

## Oracle

- 单元测试：初始 persona 是 `non-technical`；`setDomainGraph` 在 structural 下第一次到达改成 domain，knowledge 下不改，已在 domain 下不变；再次 `openProductView` 同一视图后 `productView` 与 `productRow` 不变；旧键有值、新键没有时初始主题是 Light Violet；`setDiffOverlay` 之后 `diffMode` 为 false，`toggleDiffMode` 后为 true。
- 浏览器：一个真实语料的 `explorer.html` 在清空存储后打开是 Light Violet、Overview、Domain；点 Unused 后只有 Unused 高亮、再点不关；点 Structural 回到图；Diff 显示 OFF，点开后显示 Changed 与 Affected 的计数。
