## Commit 序列

0. `docs(openspec): propose explorer-products`：本变更的文件。
1. `feat(view): pack unused-code, hotspots and doc-map into the explorer data`（1.1）。
2. `feat(explorer): drop the file and class switch, the type filters and the onboarding overlay`（2.1–2.2）。
3. `feat(explorer): copy the product data modules from the report view`（2.3）。
4. `feat(explorer): Unused, Hotspots and Doc map views`（3.1–3.4）：原计划的三个视图 commit 合为一个，理由见 design.md 验收记录。
5. `fix(smoke): stop waiting out the product views of a broken page`（4.1 门里发现）。
6. `docs(openspec): record explorer-products acceptance and archive`（4.1–4.3）。

每个 commit 单独通过 O2。

## 1. 打包

- [x] 1.1 `explorer-data.mjs` 加入三个产物的原文与 `products.json`（design D1），打包回复的 explorer 行随之列出新键。验证：O1 五个键、四种状态，先红后绿。

## 2. 顶栏与准备

- [x] 2.1 去掉 Files | Classes、函数开关、节点类型过滤（桌面与移动端），放三个按钮与 `productView` 状态（design D2）。验证：O1 切换保留选中；O3 顶栏检查。
- [x] 2.2 去掉引导弹窗（design D5）。验证：O3 没有弹窗。
- [x] 2.3 复制 `report-view` 的取数模块与单测（design D3）。验证：复制来的单测全绿。

## 3. 视图

- [x] 3.1 视图外框：页头、统计格、分布条、表格（筛选、排序、分页）、折叠块、产物状态与版本提示（design D3）。验证：组件单测；O3 not run。
- [x] 3.2 Unused 视图与行详情、「在图中显示」「打开代码」（design D4）。验证：O3 计数、high 筛选、跳转。
- [x] 3.3 Hotspots 视图（文件、目录、同改对、分组、逐年提交、行详情）。验证：O3 计数与跳转。
- [x] 3.4 Doc map 视图（文档、单元、核验、覆盖、读不了的文件、行详情）。验证：O3 计数、not-found 单元只显示引文与查找记录。

## 4. 验收

- [x] 4.1 O2 全量门。
- [x] 4.2 O4 go-multirepo 打包与截图逐项判断，记录 `explorer.html` 体积增量。
- [x] 4.3 在 design.md 末尾写验收记录，同步主规范，归档本变更。
