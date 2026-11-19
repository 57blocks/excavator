## Why

`excavator-prd-report` 按功能写 As-Is PRD 章节与功能级发现，再拼成 `PRD.md` 和一个报告页。它的读者与产物现在都由 `excavator-product-handbook` 覆盖：手册按功能写章节、列缺陷与待确认点，并生成单文件页面。用户决定不再需要这个 skill。

留着它的代价是实在的：一个 skill、一个页面包（`packages/prd-report-page`，进 typecheck 与构建）、二十多个测试文件和一组夹具都要跟着别的改动一起维护，CI 每次都跑。

两个 skill 共用一个入口清单模块（`skills/excavator-product-handbook/lib/entrypoints.mjs`）。这个模块里「读知识图的头行取框架」的分支只有 `prd-report` 用：手册按自己的设计 D10 总是传 `useGraph: false`。删掉 `prd-report` 后这个分支没有调用者，一并删掉。

## What Changes

- **BREAKING：** 删除 `skills/excavator-prd-report/`（skill、`prd.mjs` 与它的 `lib/`）。插件不再提供 `/excavator:excavator-prd-report`。
- 删除 `packages/prd-report-page/`，并从根 `package.json` 的 `typecheck` 与锁文件里去掉它。
- 删除只测 `prd-report` 的测试与夹具：`tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs`、`tests/fixtures/prd-report-pipeline/lanes/`。
- 入口清单模块的测试原来经 `prd.mjs entrypoints` 跑；改为经手册的 `handbook.mjs candidates` 或直接调模块跑。用到的三个夹具项目移到 `tests/fixtures/entrypoints/`。只测「读知识图头行」的用例随分支一起删除。
- 入口清单模块去掉 `useGraph` 选项与读知识图的代码；手册 `candidates` 的输出逐字节不变。
- 其余提到 `prd-report` 的地方改掉：README、`docs/deploy.md`、安装测试与 service-only 合约测试。
- `openspec/specs/prd-report/` 整个能力移除。归档的变更与其他活跃变更里的历史提及不改。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `prd-report`：整个能力移除（全部需求标为 REMOVED）。

## Impact

- 插件少一个 skill；用户若还在用 `/excavator:excavator-prd-report`，改用 `/excavator:excavator-product-handbook`。已生成的 `.excavator/prd-report/` 目录不受影响，只是不再有命令读写它。
- 构建与 typecheck 少一个包；依赖 `react-markdown`、`remark-gfm`、`mermaid` 仍由 `product-handbook-page` 使用，不删。
- 手册的 `candidates` 输出不变，已有运行目录里的 `candidates.json` 继续有效。
- 单篇 PRD 的 `excavator-prd` skill 与 `prd-generation` 能力不动。
