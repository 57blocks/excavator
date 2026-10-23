## Why

`explorer.html` 已是项目的主浏览页，unused-code、hotspots、doc-map 三个产物也已在它里面显示（explorer-products）。旧查看页 `view.html` 与它的前端包 `packages/report-view` 只剩维护成本：每次打包写两页，测试、冒烟与类型检查都要跑两套。用户决定让它退役，并直接删掉，不留兼容层。

## What Changes

- **BREAKING** `/excavator-view` 只写一个页面 `explorer.html`，默认 `<project>/.excavator/explorer.html`，不再写 `view.html`。
- **BREAKING** `--out <path>` 改为指 explorer 页本身。原来的规则是 explorer 页写在 `--out` 旁边，且 `--out` 不许叫 `explorer.html`，这两条一起去掉。
- **BREAKING** 回复仍是一条命令打印的五行，内容全部取自 explorer 页里的 manifest：
  - 第一行 `View:` 改为 `Explorer:`，写页面路径；
  - 问题条数单独成一行 `Issues:`；
  - `Products:` 一行加上 semantics 与 domain graph，去掉 reports。
- 删除 `packages/report-view` 整个包。它的两个构建脚本 `licenses.mjs`、`single-file.mjs` 连同测试搬进 `packages/explorer`（explorer 的构建在用它们）。
- 删除只服务 `view.html` 的冒烟与测试：
  - `scripts/view-smoke-graph.mjs`、`scripts/view-smoke-fixture.mjs`；
  - `tests/skill/excavator-view/view-template.test.mjs` 里只测 view 模板的部分。其中仍守护在用文件的检查（英文、无建议措辞），搬到别的测试里。
- `scripts/view-smoke.mjs`（通用的无头 Chrome 驱动，explorer 冒烟在用）保留，只改说明。
- 打包不再读 `hotspots-report.md`、`doc-map-report.md`。原来这两个文件读不了时整次打包失败，现在它们与打包无关。
- 主规范 `report-viewer` 删去只描述 `view.html` 的要求。仍然成立的内容（产物状态、源码内嵌、语义合并规则、三个产物视图的内容）并进描述 `explorer.html` 的要求，不再引用被删的要求。`service-only` 里「前端来自 `packages/report-view`」改为 `packages/explorer`。

失去的东西（只在 `view.html` 里有，`explorer.html` 没有对应）：
- Reports 页：两份报告 Markdown 不再出现在任何页面里，文件仍在 `.excavator/`。
- Products 页：全部产物状态的一览，改由回复的 `Products:` 一行与各视图自己的状态说明承担。
- Code 页：按五类列出被引用文件的计数，改由回复的 `Source:` 一行与打包结果的 JSON 承担。
- 行号越界的说明：产物指向的行超出文件的行数时，`view.html` 写明「该行不在当前版本的文件里」；explorer 的代码查看器只是不标出任何行。
- 其余：结构图的叠加层、两点路径、三种模式、`#/unused?row=` 这类深链接、语义陈旧条目数在页面上的显示。
- 节点详情里的产物事实（viewer-learn 第 5 片）不在本变更里，以后单独做。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `report-viewer`：打包只写 `explorer.html`；`--out` 与回复的格式改变；删去 `view.html` 各页的要求，仍成立的内容并进 explorer 的要求。
- `service-only`：唯一的 HTML 前端包从 `packages/report-view` 改为 `packages/explorer`。

## Impact

- **代码：**
  - `skills/excavator-view/` 的 `pack.mjs`、`page-assembly.mjs`、`products.mjs`、`reply.mjs`、`SKILL.md`，以及 `explorer-data.mjs`、`sources.mjs` 的注释；
  - `packages/explorer/scripts`、`packages/explorer/vite.config.ts`；
  - 删除 `packages/report-view`。
- **测试与门：**
  - `tests/skill/excavator-view/*`、`tests/skill/excavator/test_service_only_contract.test.mjs`；
  - 根 `package.json` 的 `typecheck`、`vitest.config.ts`、`pnpm-lock.yaml`；
  - 门里不再有 `view-smoke-graph`。
- **用户：**
  - 已经打出的 `.excavator/view.html` 不会被删除，也不再更新；
  - 用过 `--out x.html` 的人，现在这个路径写的是 explorer 页。
- **文档：** `README.md` 的 `/excavator-view` 说明。
