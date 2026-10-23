## 1. 提案

- [x] 1.1 写 proposal、两份 spec delta、design、tasks；`openspec validate retire-view-html --strict` 通过。commit `docs(openspec): propose retire-view-html`

## 2. 构建脚本搬进 explorer（D5）

- [x] 2.1 `licenses.mjs`、`single-file.mjs` 复制到 `packages/explorer/scripts/`（模板名改为 `explorer.html`），测试复制到 `packages/explorer/test/`；改 `fonts.mjs`、`template.mjs`、`vite.config.ts`、`src/offline/__tests__/template.test.ts` 的 import；`vitest.config.ts` 加 `packages/explorer/test/**/*.test.mjs`
- [x] 2.2 `pnpm --filter @excavator/explorer build` 与搬过去的测试绿；explorer 里不再有任何对 `report-view` 的 import。commit `build(explorer): own the licence and single-file scripts`

## 3. 只写 explorer.html（D1–D4、D6 的打包测试）

- [x] 3.1 `pack.mjs`：`--out` 指页面本身，默认 `.excavator/explorer.html`；删去 view 页与名字检查；结果字段提到顶层
- [x] 3.2 `page-assembly.mjs` 删去 view 页的组装；`products.mjs` 删去 reports；explorer manifest 升到 2，加 `products` 与 `source`
- [x] 3.3 `reply.mjs` 按 D2 打印五行，只读 explorer manifest；先写测试，在旧代码上看到红
- [x] 3.4 `explorer-data.mjs`、`sources.mjs`、`products.mjs` 的注释不再引用 view 页
- [x] 3.5 `tests/skill/excavator-view/` 的 pack 系列测试改为断言打包结果、explorer 页或 `collectProducts`；删去 `--out` 旁边与名字检查的测试，加 D1 的两个场景（任意文件名、旧 `view.html` 原样保留）；`view-template.test.mjs` 删除，仍成立的文件级检查搬进 `skill-contract.test.mjs`，绊线先红后绿（打包不再写 view 页，这些测试在这一步就失去对象）
- [x] 3.6 `SKILL.md` 按新的一页、新的 `--out` 与五行改写
- [x] 3.7 相关测试绿。commit `feat(view): pack only explorer.html`

## 4. 删除 view.html 的一切（D6、D7 的仓库部分）

- [x] 4.1 删除 `packages/report-view`（连同第 2 步留下的两个脚本旧副本）、`scripts/view-smoke-graph.mjs`、`scripts/view-smoke-fixture.mjs`
- [x] 4.2 根 `package.json` 的 `typecheck`、`vitest.config.ts`、`pnpm-lock.yaml`（`pnpm install`）去掉 report-view
- [x] 4.3 `test_service_only_contract.test.mjs` 改为只允许 `packages/explorer`
- [x] 4.4 `scripts/view-smoke.mjs`、`scripts/explorer-smoke.mjs` 的说明，`README.md` 的 `/excavator-view` 一段
- [x] 4.5 Oracle 2 的 grep 零命中。commit `chore(view): delete view.html and packages/report-view`

## 5. 验收与归档

- [ ] 5.1 在分离检出上跑全量门（Oracle 3）
- [ ] 5.2 镜像真实运行（Oracle 5），记录在本文件末尾
- [ ] 5.3 归档：spec 并入主规范。commit `docs(openspec): archive retire-view-html`
