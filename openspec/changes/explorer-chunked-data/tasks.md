## 1. 打包写出压缩块

- [ ] 1.1 `page-assembly.mjs`：按 design D2/D3/D5 写出索引块与 gzip+base64 数据块，按字节拼接页面；切不开的值报错写明产物与字段。验证：`tests/skill/excavator-view/pack.test.mjs` 新增的切分、上限、确定性与报错用例通过
- [ ] 1.2 `tests/skill/excavator-view/page.mjs` 改为解开块读回 `data`（design D6），`tests/skill/excavator-view/` 下全部测试通过（oracle O1、O5）

## 2. 页面按需解开

- [ ] 2.1 `packages/explorer/src/offline/inlineData.ts` 按 design D4 从索引与块读取并缓存，`has*` 只查索引。验证：`inlineData.test.ts` 新增的解块、缓存与不解块用例通过（oracle O2），`pnpm --filter` explorer 的测试与类型检查通过
- [ ] 2.2 `pnpm -r build` 后跑 `tests/skill/excavator-view/` 与 explorer 测试，确认模板与打包对得上

## 3. 真实验收

- [ ] 3.1 用已有的大型 Java 仓库 `.excavator` 重新打包，在 Chrome `file://` 下按 oracle O3 检查并记录体积、堆、打开时间与只看图时解开的块
- [ ] 3.2 在临时目录按 oracle O4 造超上限产物，打包并在 Chrome 打开，记录结果；数据不提交
