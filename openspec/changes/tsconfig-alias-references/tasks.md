## 1. 先验装置（先红）

- [x] 1.1 在 `test_extract_import_map.test.mjs` 新增 `tsconfig references and extends` 一组：Vite 布局、清单里没有被引用配置、被引用配置只作用于自己目录、引用目录、歧义无边、同一文件不算歧义、`extends` 继承与锚定、缺失与越界只告警、被引用配置解析失败记一次、`extends` 成环。在旧代码上跑，确认这些用例全部红（记录在 acceptance）
- [x] 1.2 在 `test_coverage_ledger.test.mjs` 新增 `imports-ambiguous` 用例，在旧账本上红
- [x] 1.3 在 `test_prepare_incremental.test.mjs` 新增「只改共享基础配置」用例，在旧增量逻辑上红

## 2. 实现

- [x] 2.1 `extract-import-map.mjs`：`parseTsConfigText` 读出 `extends` 与 `references`；`loadTsConfigs` 构建作用域，按 TypeScript 规则继承并锚定，越界与缺失只告警；`resolveTsJsImport` 对所有适用作用域解析，多个不同结果进 `ambiguous`；输出 `ambiguous`、`tsConfigFiles` 与两项计数
- [x] 2.2 `coverage-ledger.mjs`：按语言产出 `imports-ambiguous`
- [x] 2.3 `prepare-incremental.mjs`：选择性重算之后，若改动路径与 `tsConfigFiles` 相交则整表重算

## 3. 验收

- [x] 3.1 端到端：Vite 布局夹具跑 `lazy-analyze.mjs`，新旧脚本各一次，记录 `imports` 边数与 `imports-unresolved` 样本
- [x] 3.2 变异：去掉目录限制、歧义改为取第一个、歧义不从 `unresolved` 去掉、不跟随 `references`、`extends` 锚定改到子配置目录、越界检查失效、增量不看 `tsConfigFiles`，逐个确认至少一个用例变红
- [x] 3.3 记录到 `acceptance.md`（只写机制与规模，不写语料名）

## 4. 门与合并

- [x] 4.1 本地只跑受影响范围：三个测试文件，加上读 import map 输出的测试（`git grep -l "extract-import-map\|coverage-ledger\|prepare-incremental" -- tests`）一条 vitest 命令；`openspec validate --all --strict`。全量交给 CI gate
- [ ] 4.2 分阶段 commit，PR 用 `--merge` 指向 `main`，评审按 REVIEW.md
