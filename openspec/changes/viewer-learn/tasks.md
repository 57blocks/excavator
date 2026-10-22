## Commit 序列

0. `docs(openspec): propose viewer-learn`：本变更的文件。
1. `feat(view): pack the tour product and rename Overview to Products`（1.1–1.3）。
2. `feat(view): inline fonts and shared page components`（2.1–2.2）。
3. `feat(view): detail pages with stats, charts, row panels and row links`（3.1–3.3）。
4. `feat(view): modes, the Domain and Structural switch, and the project overview`（4.1–4.3）。
5. `feat(view): product facts with links in node details`（5.1–5.2）。
6. `feat(view): learn panel driven by the tour`（6.1–6.2）。
7. `feat(view): layered layout, layer cards, in-place folders and portal cards`（7.1–7.3）。
8. `feat(view): edges, labels, selection, search rings and domain cards`（7.4–7.6）。
9. `docs(openspec): record viewer-learn acceptance and archive`（8.1–8.4）。

每个 commit 自带测试与冒烟场景，单独通过 O2。冒烟里的悬停一律用真实指针事件。

## 1. 打包与改名

- [x] 1.1 `skills/excavator-view/products.mjs` 读 `tour.json`（design D8）：四种状态，载荷只留 `steps`、`removed`、`gaps`、`counts`、`contentLanguage`。验证：O1 打包的导览四种状态先红后绿。
- [x] 1.2 `reply.mjs` 的 Products 行加上导览；skill 契约测试与 O5 期望同步。验证：单测。
- [x] 1.3 Overview 页改名 Products（design D9），`#/overview` 重定向。验证：O1 旧路由重定向先红后绿；冒烟场景 `products-redirect`。

## 2. 字体与共用组件

- [x] 2.1 `@fontsource` 拉丁子集内联（design D7），`--font-heading` token，模板开头的许可声明，3% 噪点。验证：O1 字体与噪点在模板里、无外部请求；模板大小增量记入验收。
- [x] 2.2 `PageHeader`、`StatTile`、`BarList`、`AreaSpark`、`Histogram`、`RowPanel`（design D6），SVG 手写，入场动效与减少动效的终态。验证：组件单测（数值与条长成比例、减少动效下无动画）。

## 3. 详情页

- [x] 3.1 Unused、Hotspots、Doc map 页换成页头、统计格与分布图（spec「详情页的行面板与跳转」）。验证：冒烟核对图中各数与产物计数相等。
- [x] 3.2 行面板：字段、源码预览、在图中定位、打开代码；Unused 加组成员与引用者，Hotspots 文件行加逐年提交与同改文件。验证：冒烟 `row-panel-unused`、`row-panel-hotspots`。
- [x] 3.3 hash 参数 `row` 与 `prefix`：分页、滚动、高亮、找不到时写明；Code、Reports 与 Products 页的版式（design D6）。验证：O1 `row=` 与 `prefix=` 的 hash 往返先红后绿；冒烟 `row-link`、`prefix-filter`。

## 4. 模式、切换与总览

- [ ] 4.1 `mode` 参数与顶栏分段按钮（design D1）：Overview 隐去函数与类、计数不变；搜索命中隐去节点时切到 Deep dive 并写明。验证：O1 模式对节点的过滤与计数不变、搜索切模式，各先红后绿。
- [ ] 4.2 Domain | Structural 分段按钮（design D2），两边保留各自位置。验证：冒烟 `domain-structural`。
- [ ] 4.3 `ProjectOverview`（design D3）。验证：单测核对各计数取自产物；冒烟 `overview-mode`。

## 5. 节点详情

- [ ] 5.1 产物事实取数（design D5）：hotspots 排名与同改前 3、unused 组与入口与引用者、doc-map 单元；「不在列表里」与 not run 分开。验证：O1 产物事实取数先红后绿。
- [ ] 5.2 跳转按钮、容器与层的范围汇总、复杂度徽章、「本文件定义的」、侧栏前进后退。验证：冒烟 `node-facts-jump`（点按钮后详情页选中的行等于该记录、面板打开）。

## 6. 导览面板

- [ ] 6.1 `LearnPanel` 三种状态与 different revision（design D4）；`unverified` 与 `unchecked` 标记、`removed` 计数与展开。验证：单测。
- [ ] 6.2 进入一步时切层、展开到最深公共容器、fitView、脉动；`tour` 参数、`←`/`→`/`Esc`。验证：O1 导览步骤到最深公共容器、`tour=` 往返先红后绿；冒烟 `tour-walk`（夹具包带一份导览）。

## 7. 图的视觉

- [ ] 7.1 ELK `layered`（结构图 DOWN、领域图 RIGHT，间距按 design D10），去掉网格退路。验证：冒烟核对卡片两两不相交、顶层不是网格（行列不全对齐）。
- [ ] 7.2 移植 UA 的层卡片与文件、函数、类卡片（保留 MIT 声明），层色 7 色循环、类型标签、复杂度、两行摘要。验证：冒烟用计算样式核对色条宽与层色、卡片宽与圆角。
- [ ] 7.3 层内文件夹原地展开、400 上限与折叠计数；其它层的传送卡。验证：O1 下钻计数（落在展开的框上）先红后绿；冒烟 `folder-expand`、`portal-card`。
- [ ] 7.4 边：强调色、宽度上限 5、聚合边无箭头；标签常显、按长度放置、相交不画、悬停总能看到。验证：冒烟核对可见标签两两不相交且不压卡片、悬停的边标签可见。
- [ ] 7.5 选中淡化到 .2、相连边加粗流动；搜索描边与命中数；点阵、MiniMap 与面包屑样式。验证：冒烟 `select-dim`、`search-rings`。
- [ ] 7.6 领域卡片的实体药丸与「+N」、flow 与 step 卡片、跨领域流动虚线边；减少动效下流动、脉动与淡化过渡都关闭。验证：冒烟 `domain-cards`、`reduced-motion-graph`。

## 8. 验收

- [ ] 8.1 O2 全量门。
- [ ] 8.2 O1 注入变异逐一先红后绿，记录结果。
- [ ] 8.3 O4 go-multirepo（用 tour-product 在克隆上产出的 `tour.json`）与截图逐项判断；O5 skill 真实运行。
- [ ] 8.4 在 design.md 末尾写验收记录，同步主规范，归档本变更。
