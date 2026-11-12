## Why

viewer-app 交付了结构图、领域图与各产物页，用户看过后提出三点：
- Understand Anything 更美观，要有它现有的 Overview、Learn、Deep dive 三种模式与 Domain | Structural 切换，再加上 Excavator 自己的 unused code、hotspots 等；
- 图上已能叠加 hotspots 与 unused，但点开节点时要看到这些数据本身，并能一键跳到对应详情页；
- 详情页（Unused、Hotspots 等）样式简陋，要美化并尽量加动效。

Learn 依赖导览数据，由 tour-product 变更先产出 `.excavator/tour.json`。

## What Changes

- **三种模式**，顶栏的分段按钮，写进 hash，照 Understand Anything 的语义：
  - Overview：结构图隐去 function 与 class 节点；空闲时侧栏显示项目总览；
  - Learn：空闲时侧栏显示导览面板，走到某一步时图移到这一步的节点并让它们脉动，讲解里未核验的句子有标记；
  - Deep dive：全部节点，空闲侧栏显示项目总览。
- **Domain | Structural 切换**：图页顶部的分段按钮，在领域图与结构图之间切换，镜头过渡；左侧导航保留。
- **项目总览侧栏**：项目名与描述（取领域图的 `project.description`）、统计格、语言与框架、节点类型分布条、复杂度分布、连接最多的节点（可点）、层列表，以及各产物的要点（未使用函数数、最热的文件），每项可跳转。
- **节点详情增强**：复杂度徽章、「本文件定义的节点」、侧栏内的前进后退、衬线标题。产物事实写出数据本身：
  - hotspots：提交数、作者数、增删行数、分数与排名、最近修改、最常一起改的文件；
  - unused：原因、可信度、信号、所在组、引用者；
  - doc-map：引用它的单元。

  每项带「在 Unused / Hotspots / Doc map 中打开」，跳到详情页并选中、展开那一行。容器与层卡片在叠加层打开时显示该范围的汇总，并能跳到按该范围过滤的详情页。
- **详情页重做**（Unused、Hotspots、Doc map、Code、Reports、产物总览页）：卡片与标题照 Understand Anything 的版式，统计数字滚动，分布用条形图与面积图，表格行依次进场；行点开是右侧详情面板（字段、源码预览、在图中定位、相关行），Hotspots 的文件面板有逐年提交与一起改的文件。全部遵守减少动效。
- **图的视觉照 Understand Anything**（用户：「graph 也没有 UA 好看」）：移植 UA 的节点组件（MIT）；ELK 分层布局、不再退成网格；层卡片按层着色、衬线名称、复杂度、悬停提示；文件、函数、类卡片带类型标签、复杂度与两行摘要；层内的文件夹原地展开，其它层的邻居用虚线「传送卡」表示；边用强调色、计数标签在不相交时常显；选中时淡化无关卡片、相连的边流动；搜索命中在画布上描边并计数；领域图从左到右，卡片带实体药丸，跨领域边流动。
- **字体**：标题用 DM Serif Display、正文 Inter、代码 JetBrains Mono，以 woff2 内联进模板，离线可用；颜色仍是 57blocks 浅色。
- **左侧导航**里原来的 Overview 页改名为 Products，避免与 Overview 模式同名，内容不变。
- 打包读入 `tour.json`：新增导览产物的状态（not run、unreadable、different revision、included），`/excavator-view` 回复的 Products 行随之多出导览一项。

## Capabilities

### New Capabilities
<!-- 无：都是查看页的一部分。 -->

### Modified Capabilities
- `report-viewer`：新增模式、领域与结构切换、项目总览、导览面板、节点产物事实与跳转、详情页面板等要求；产物列表加入导览；Overview 页改名 Products。

## Impact

- **代码：** `packages/report-view/src` 的顶栏、侧栏、各页与图；`skills/excavator-view/products.mjs` 等打包脚本加入导览；冒烟脚本与测试。
- **大小：** 字体约 150–250 KB 加到模板上。
- **依赖：** 只在 `packages/report-view` 新增三个字体开发依赖 `@fontsource/dm-serif-display`、`@fontsource/inter`、`@fontsource/jetbrains-mono`（SIL OFL，只取拉丁子集），构建时内联，许可证写进模板开头的声明；图表用 SVG 手写，不引图表库。
- **不变：** 只读 `.excavator/`、不联网、不起服务、只有浅色主题；各产物的格式；`/excavator-view` 回复的行数与格式（只是 Products 行多出导览一项）。
