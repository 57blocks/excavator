## 1. 变更提案（commit 1）

- [x] 1.1 proposal、design、tasks 与 `specs/prd-report/spec.md`（全部需求 REMOVED）；`openspec validate remove-prd-report --strict` 通过
- [x] 1.2 动手前用当时的 `handbook.mjs candidates` 生成 `tests/fixtures/entrypoints-golden/` 四个金样（O1）

## 2. 入口清单测试换入口（commit 2，此时 prd-report 仍在）

- [x] 2.1 `git mv` 三个夹具项目到 `tests/fixtures/entrypoints/`，改所有引用它们的路径
- [x] 2.2 手册测试目录加入口清单测试：原 `entrypoints.test.mjs`、`entrypoints-nestjs.test.mjs` 的用例经 `handbook.mjs candidates` 或 `listEntrypoints` 跑；共用小工具移到手册 helpers；`candidates.test.mjs` 不再从 prd-report 的 helpers 引入
- [x] 2.3 金样测试 `entrypoints-golden.test.mjs` 改为比 `tests/fixtures/entrypoints-golden/`，做一次变异确认会红（O1）

## 3. 删除 prd-report（commit 3）

- [x] 3.1 删除 skill、页面包、prd-report 测试目录、合约测试、`lanes` 夹具、旧金样目录
- [x] 3.2 根 `package.json` 的 `typecheck` 去掉该包，`vitest.config.ts` 去掉它的测试目录，`pnpm install` 更新锁文件
- [x] 3.3 安装测试与 service-only 合约测试去掉对它的期望
- [x] 3.4 README 与 `docs/deploy.md` 去掉该 skill 的段落与命令（与删除同一个 commit，否则 `check-refs` 在这一步就红）

## 4. 去掉读知识图的分支（commit 4）

- [x] 4.1 `listEntrypoints` 去掉 `useGraph` 与读头行的代码，输出保持 O1；`candidates.mjs` 与 `run-precision.test.mjs` 不再传 `useGraph`
- [x] 4.2 删除只测知识图头行的用例，记下用例名（O3）：迁移时（commit 2）没有带过来的两个是「puts a framework the catalog has no patterns for in uncovered, with no candidates」与「reads the frameworks from the knowledge-graph header when there is one」；手册「从不读知识图」的 D10 用例保留

## 5. 收尾检查

- [ ] 5.1 O2 的全仓 grep 符合预期；O4 全部检查通过
