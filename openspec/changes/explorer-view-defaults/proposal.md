## Why

在 `explorer.html` 里打开 Unused（或 Hotspots、Doc map）视图时，顶栏的 Domain 或 Structural 仍然高亮，看起来同时选中了两样东西，而中间显示的只是产物视图。再点一次已经打开的产物按钮会关掉视图回到图，用户把它当成误操作。打开页面时默认是 Learn 视角与结构图，用户要的是 Overview 与领域图；有差异覆盖层时 Diff 默认打开，用户要默认关闭。主题的默认已是 Light Violet，但副本原来那个键里存过的选择（包括 Light Violet 成为默认之前存下的）会盖过它。

## What Changes

- 顶栏的高亮只给中间正在显示的东西：产物视图打开时只高亮它的按钮，Domain 与 Structural 不高亮；手机抽屉里的同一组按钮同样处理。
- 再点已经打开的产物按钮不再关闭视图；回到图改由点 Domain / Structural 或按 Esc。
- 打开页面时视角默认 Overview；有领域图时模式默认 Domain，没有领域图时仍是 Structural。
- 有差异覆盖层时 Diff 开关默认关闭，点开后与原来一样显示计数与层卡片的高亮。
- 主题选择改存在页面自己的键下，副本原来那个键里的选择不再读，所以没在本页面选过主题的用户看到默认的 Light Violet。

## Capabilities

### New Capabilities

### Modified Capabilities
- `report-viewer`：「离线仪表盘」加上打开时的默认视角与模式、主题选择的存储键；「离线仪表盘的产物视图」改高亮规则与再点同一个按钮的行为；「差异覆盖层」改 Diff 开关的默认状态。

## Impact

- `packages/explorer/src`：`store.ts`（默认视角、领域图到达时的默认模式、去掉产物视图的开关式切换）、`App.tsx` 与 `components/MobileDrawer.tsx`（模式按钮的高亮条件）、`excavator/ProductSwitch.tsx`、`themes/ThemeContext.tsx`（存储键）、`store.ts` 的 `setDiffOverlay`（Diff 默认关闭）及对应测试。
- 不动任何 `.excavator` 产物与打包脚本；已有的 `explorer.html` 换模板时数据块原样搬过去。
