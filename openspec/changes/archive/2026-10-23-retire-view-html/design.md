## Context

`/excavator-view` 现在一次写两页：`view.html`（`packages/report-view` 的模板）和它旁边的 `explorer.html`（`packages/explorer` 的模板）。回复的五行里，状态与源码计数读自 `view.html` 的 manifest，问题条数读自 `explorer.html` 的 manifest。explorer 的构建借用 report-view 的两个脚本（许可声明与单文件检查）。本变更删掉前者，只留后者。

## Goals / Non-Goals

**Goals:**
- 打包只写 `explorer.html`；`packages/report-view` 与只为它存在的脚本、测试、冒烟全部删除。
- 回复仍是一条命令打印的五行，全部取自 explorer 页的 manifest。
- 主规范只描述还存在的页面，不引用被删的要求。

**Non-Goals:**
- 不给 explorer 补 Reports、Products、Code 页或 `view.html` 的叠加层、路径、深链接。
- 不删除项目里已有的 `.excavator/view.html`。
- 不做节点详情里的产物事实（viewer-learn 第 5 片）。

## Decisions

### D1 `--out` 指页面本身

`--out <path>` 就是 explorer 页的路径，默认 `<project>/.excavator/explorer.html`，文件名不限。旧的「explorer 页写在 `--out` 旁边」和「`--out` 不许叫 `explorer.html`」两条一起去掉。

**理由：** 只剩一页，「旁边」没有意义；拒绝名字的检查只为两页不互相覆盖。

**代价：** 老用法 `--out x.html` 的含义变了：从前那里是 view 页、旁边另有 explorer 页，现在那里就是 explorer 页、旁边什么也不写。

### D2 回复的五行

```
Explorer: <absolute path>
Size: <MB, one decimal> MB
Issues: <N>                                        (no graph: Issues: not counted; knowledge graph <state>)
Products: knowledge graph <s>; semantics <s>; domain graph <s>; unused code <s>; doc map <s>; hotspots <s>; tour <s>
Source: <embedded (N files) | not embedded>
```

- `reply.mjs <explorer.html>` 一条命令打印五行，每个词都写在脚本里。
- `Products:` 列出页面用到的全部七个产物。这样 spec 里「没有领域图 → 回复写明领域图 not run」第一次真正成立：旧回复没有 domain graph 这一项。
- reports 不再打包，所以从这一行去掉。

**代价：** 依赖旧行首 `View:` 的人或脚本要改。仓库里没有这样的消费者。

### D3 explorer manifest 升到 2

`xv-explorer-manifest` 加两个字段，`explorer` 改为 `2`：
- `products`：`[{ name, status }]`，七个产物，按 D2 的顺序；
- `source`：`{ embedded, counts }`。

`issues`、`keys`、`rows` 不变。回复只读这一个 manifest。

`products` 的状态是页面实际放进去的情况（评审第 1 轮补）：`collectProducts` 只看知识图谱的文件头，打包读全文时拒绝了正文，页面就没有图，知识图谱写为 `unreadable`；没有图时，读得到的语义与导览写为 `not-shown`。打包结果的 `products` 用同样的状态。

### D4 打包代码删什么

- `page-assembly.mjs`：删去 `assemblePage`、`dataBlocks`、`encodePayload` 与 `TEMPLATE_PATH`。explorer 页的组装与内容安全策略不变。
- `pack.mjs`：删去 view manifest 与 view 页的写出。打包结果 `{ out, bytes, snapshotRevision, products, source, issues, keys, rows }` 描述的就是 explorer 页：原 `explorer` 子对象的字段提到顶层。
- `products.mjs`：删去 `readReports`。条目里供 view 页用的字段（`label`、`payloads` 等）留着：`sources.mjs` 与 `explorer-data.mjs` 仍读 `payloads`，不顺手重构。
- `explorer-data.mjs`、`sources.mjs` 里引用 view 页或 `packages/report-view/src/...` 的注释，改为直接写出规则本身。

### D5 构建脚本搬家

- `packages/report-view/scripts/licenses.mjs`、`single-file.mjs` 搬到 `packages/explorer/scripts/`，测试搬到 `packages/explorer/test/`：
  - 改相对 import 与注释里的路径；
  - `single-file.mjs` 的模板名从 `view.html` 改为 `explorer.html`，于是 `template.mjs` 只需把 vite 的 `index.html` 改名一次，不再先改成 `view.html`、再改回 `explorer.html`；
  - 搬家分两步：第 2 步先复制，让 report-view 在它被删之前照常构建；第 4 步随包删去旧的那份。
- `vitest.config.ts` 的 include 把 `packages/report-view/test/**` 换成 `packages/explorer/test/**/*.test.mjs`。
- report-view 自己的 `fonts.mjs`、`check-template.mjs` 随包删除：explorer 有自己的。

### D6 冒烟与测试

- 删除 `scripts/view-smoke-graph.mjs`、`scripts/view-smoke-fixture.mjs` 和 `packages/report-view/test/**`。
- `scripts/view-smoke.mjs` 是通用的无头 Chrome 驱动，explorer 冒烟在用。它保留原名，只改说明：改名会牵动冒烟与记录，换不来什么。
- `tests/skill/excavator-view/`：
  - 经 view 页 manifest 或 payload 断言的测试改为断言打包结果或 explorer 页的数据与 manifest，不是删掉；
  - `page.mjs` 只留读 explorer 页的帮手；
  - `view-template.test.mjs` 删除；其中仍守护在用文件的检查（skill 与脚本无中文字符、无建议措辞，带唱反调的绊线），搬进 `skill-contract.test.mjs`。
- `test_service_only_contract.test.mjs`：唯一允许带 HTML 的包改为 `packages/explorer`，绊线随之改。

### D7 规范

- `report-viewer`：
  - 删去 17 条只描述 `view.html` 的要求；
  - 改写打包、产物状态、源码、skill、离线仪表盘与产物视图 6 条，不再引用被删的要求，三个产物页的内容并入产物视图；
  - 「产物内容只当文字」不变。
- `service-only`：前端包改为 `packages/explorer`。

## Oracle

1. `packages/report-view`、`scripts/view-smoke-graph.mjs`、`scripts/view-smoke-fixture.mjs` 不在树里。
2. 在 `openspec/` 以外，`git grep -nP "report-view(?!er)|view\.html|view-smoke-(graph|fixture)"` 只命中两处有意的例外：
   - `pack.test.mjs` 里「旧 `view.html` 原样保留」的测试；
   - `skill-contract.test.mjs` 里断言 SKILL.md 不提 `view.html` 的反向检查。
   `openspec/specs/` 在归档时随 delta 更新。
3. 全量门绿：
   - `pnpm install --frozen-lockfile`、`pnpm -r build`、`pnpm typecheck`、`node scripts/check-refs.mjs`；
   - `openspec validate --all --strict`、`claude plugin validate .`；
   - `pnpm test`、`node scripts/explorer-smoke.mjs --self-check`。
4. 回复：新的 `reply.mjs` 测试在旧代码上是红的（旧代码打印 `View:`），在新代码上绿。
5. 真实运行：从镜像打包，`--out` 指到语料外。要满足：
   - 只多出那一个文件；
   - 回复五行，状态与产物一致；
   - 页面能打开，除 `file:` 与 `data:` 外没有请求；
   - 三个产物视图的计数与旧回合验收时相同。

## Risks / Trade-offs

- [老的 `view.html` 留在用户项目里，会过时] → 打包不删用户文件，这是 spec 的约束。README 写明现在只写 `explorer.html`。
- [删掉的冒烟里有 explorer 冒烟没覆盖的检查] → 那些检查测的都是 `view.html` 自己的行为，页面没了，检查也就没有对象。仍成立的文件级检查按 D6 搬走。
