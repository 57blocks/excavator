## 1. 打包写出压缩块

- [x] 1.1 `page-assembly.mjs`：按 design D2/D3/D5 写出索引块与 gzip+base64 数据块，按字节拼接页面；切不开的值报错写明产物与字段。验证：`tests/skill/excavator-view/pack.test.mjs` 新增的切分、上限、确定性与报错用例通过
- [x] 1.2 `tests/skill/excavator-view/page.mjs` 改为解开块读回 `data`（design D6），`tests/skill/excavator-view/` 下全部测试通过（oracle O1、O5）
- [x] 1.3 `sources.mjs`、`semantics.mjs` 按 design D7 逐行读知识图谱的 `Buffer`。验证：`tests/skill/excavator/jsonl-buffer-lines.test.mjs` 与 `tests/skill/excavator-view/graph-lines.test.mjs` 通过，后者在旧代码上 4 个用例以 `RangeError` 失败

## 2. 页面按需解开

- [x] 2.1 `packages/explorer/src/offline/inlineData.ts` 按 design D4 从索引与块读取并缓存，`has*` 只查索引。验证：`inlineData.test.ts` 新增的解块、缓存与不解块用例通过（oracle O2），`pnpm --filter` explorer 的测试与类型检查通过
- [x] 2.2 `pnpm -r build` 后跑 `tests/skill/excavator-view/` 与 explorer 测试，确认模板与打包对得上

## 3. 真实验收

- [x] 3.1 用已有的大型 Java 仓库 `.excavator` 重新打包，在 Chrome `file://` 下按 oracle O3 检查并记录体积、堆、打开时间与只看图时解开的块
  - 体积 507,659,518 → 55,268,818 字节；打包 257 秒、峰值 RSS 2.1 GB；load 事件 559 ms；`performance.memory` 读数 290 MB（改前 1.36 GB）
  - 启动解开 22 块，正好是 knowledge-graph 18、meta 1、staleness 1、products 2；unused-code、hotspots、doc-map 与源码的块都没有解开
  - 打开 Unused / Hotspots / Doc map 各自只解开本产物的块（10 / 6 / 4+1），再次打开不再解开；打开一个源文件解开 1 块并定位到第 248 行
  - 没有控制台错误与 CSP 违规；用测试读回函数解开新页面，8 个产物与 16,936 个源文件逐项等于旧页面的数据块
- [x] 3.2 在临时目录按 oracle O4 造超上限产物，打包并在 Chrome 打开，记录结果；数据不提交
  - 合成图 60,050 个节点、60,000 条边，`knowledge-graph.json` 556,742,422 字符；首次打包在 `graphFilePaths` 整串解码处失败，按 D7 修复后打包成功（23 秒、峰值 RSS 1.96 GB、页面 241 MB、0 个问题）
  - Chrome `file://` 打开：load 1,178 ms，图显示 60,050 节点与 60,000 边，没有控制台错误与 CSP 违规
