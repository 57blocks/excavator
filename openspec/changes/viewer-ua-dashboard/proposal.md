## Why

用户比较了查看器与 Understand Anything（UA）的仪表盘之后决定：「我们直接把 ua 的实现复制过来算了」「不是 graph code，而是整个 html 部分。先复制，我们之后再做修改」。在自己的查看器里逐项仿 UA（viewer-learn 的第 7、8 片）进展慢，而且仿出来的东西与 UA 仍有差距：例如聚焦视图把全图的一跳邻居摊平画出，go-multirepo 上一个被到处引用的文件要画 288 张卡片、5,786 条边，而 UA 只取本层、按目录聚合。

UA 是 MIT 许可。它的仪表盘是 Vite + React 单页应用，图、布局、聚类都在浏览器里跑；Node 进程只负责送页面、校验令牌、送六个数据文件与源码、算陈旧度。这些在我们的查看器里都已有离线做法（单个 HTML、数据与源码内联、blob Worker），所以整份复制过来也能做到「双击 HTML 就能看，不起服务」。

## What Changes

- **整份复制 UA 仪表盘**：`understand-anything-plugin/packages/dashboard` 的源码（含测试）与它用到的 `packages/core` 中的类型、校验与搜索模块，原样放进新包 `packages/ua-view`，保留 MIT 许可与来源提交号。第一个 commit 只有原样复制，之后的每处改动都能在 diff 里看到。
- **只为离线做最少的改动**：
  - 六处 `fetch` 数据文件改为读页面里内联的数据；
  - 代码查看器的源码改为读内联的源码；
  - 去掉令牌门（`TokenGate`）；
  - 布局 Worker 改为内联的 blob Worker；
  - 陈旧度在打包时算好写进页面；
  - 整个应用构建成一个自包含的 HTML 模板，不发任何网络请求。
  除此以外的界面、交互、主题与文案都不改。
- **打包**：`/excavator-view` 额外写出 `.excavator/ua-view.html`，数据取自现有产物，只改形状不改内容：
  - `knowledge-graph.jsonl` 拼回一个 JSON；
  - `domain-graph.json` 原样；
  - `tour.json` 的步骤放进图的 `tour`；
  - `meta.json` 原样；
  - 源码按现有规则内联（`--no-source` 照旧）。
  回复多一行写出这个文件的路径与状态。
- 现有的查看器（`packages/report-view`、`.excavator/view.html`）**这次不动、不删**。Excavator 自己的页面（Products、Unused、Hotspots、Doc map、Code、Reports）与图上的叠加层，之后作为对副本的修改逐项加进来；全部加完后再退役旧包。
- viewer-learn 已完成的第 1–4 片保留；它余下的第 5–8 片暂停，之后改写成对副本的修改。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `report-viewer`：新增「UA 仪表盘副本」一条要求。

## Impact

- 新包 `packages/ua-view`（MIT 来源文件，`@xyflow/react`、`elkjs`、`graphology`、`graphology-communities-louvain`、`zustand`、`@dagrejs/dagre`、`d3-force`、`react-markdown`、`remark-gfm`、`prism-react-renderer` 等依赖）。
- `skills/excavator-view/`：打包脚本多写一个文件，回复多一行。
- 测试：UA 自带的测试随复制进来，在我们的 `pnpm test` 里跑；新增打包与离线的测试。
