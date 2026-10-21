## Why

report-viewer 的查看页是纯 JS 手写的表格页：能看数字、能跳源码，但没有图、没有详情面板、没有过渡，用户评价是「太简陋」。用户要的是交互和样式都接近 Understand Anything 的 dashboard，并澄清了「零依赖」的本意：可以用第三方库，只要双击 HTML 就能运行，打开的人不需要 Node、不需要联网、不需要起服务。

本仓库在 2026-09 删掉的 `packages/dashboard` 就是 Understand Anything dashboard 的 fork（React + React Flow + ELK）。它的问题只在于数据走 HTTP、要起 dev server。把它改成构建期打成单文件、数据由 report-viewer 的打包脚本内联，就能同时满足两点。

## What Changes

- 新增工作区包 `packages/report-view`：以删除前的 `packages/dashboard` 为起点（React 19、`@xyflow/react`、elkjs、d3-force、Tailwind 4），加 `motion` 做动效。`pnpm -r build` 把它构建成**一个** HTML 模板，所有 JS、CSS、Worker 都内联，没有分块、没有外部文件。包里没有 dev server、preview 或任何 HTTP 服务脚本。
- `skills/excavator-view/pack.mjs` 改用这个模板。产物状态、源码分类、确定性、原子写、CSP 与载荷格式全部保留。CSP 只多一条 `worker-src blob:`，用于力导向布局的内联 Worker。模板没构建时，打包失败，并说明要先运行 `pnpm build`。
- **BREAKING（仅仓库内部）**：删除 `viewer/` 下的纯 JS 前端和它的静态门测试。现有各页（Overview、Unused、Doc map、Hotspots、Code、Reports）的内容要求不变，用 React 重写。
- 新增**结构图**作为默认视图，交互照 Understand Anything：
  - 层或目录分组的逐级下钻、面包屑、MiniMap、缩放控件；
  - 节点详情侧栏（字段、入边与出边、该节点在各产物里的事实）；
  - 底部代码抽屉，高亮行范围；
  - 搜索、过滤（节点类型、边类型、层）、1 跳聚焦、两点最短路径、返回历史、快捷键。
- 新增**产物叠加层**：在图上叠加 hotspots 热度、unused 标记、doc-map 有无证据，可分别开关；表格页的每一行都能「在图中定位」。
- 样式：版式与组件层次照 Understand Anything，包括顶栏、玻璃质感浮层、侧栏、抽屉与圆角卡片。配色仍是 57blocks 浅色 token（report-viewer 的 D6），只有浅色主题。动效语汇取 57blocks 官网：缓动 `cubic-bezier(.16,1,.3,1)`、0.2–0.45 s、进场上移淡入。系统要求减少动效时，动效全部关闭。
- 修改 `service-only` 规范：把「查看页前端没有 npm 依赖、没有构建步骤」改为「构建产物是一个可从 `file://` 打开的文件，不由任何进程提供」，并点名 `packages/report-view` 是唯一的前端包。

## Capabilities

### New Capabilities
<!-- 无：图、详情、叠加层都是查看页的一部分，写进 report-viewer。 -->

### Modified Capabilities
- `report-viewer`：
  - 「打包成一个自包含的 HTML」改为用构建出的模板，CSP 加 `worker-src blob:`，去掉「无 npm 依赖、无构建步骤」；
  - 「界面与主题」加入版式、动效与减少动效；
  - 新增「结构图」「节点详情与代码抽屉」「搜索、过滤、聚焦与路径」「产物叠加层」「快捷键与返回」五条要求。
- `service-only`：放宽前端代码的形态限制，范围钉死在一个包、一个文件、不起服务。

## Impact

- **新增依赖，只在 `packages/report-view`：** react、react-dom、@xyflow/react、elkjs、d3-force、motion、prism-react-renderer、react-markdown、remark-gfm、zustand，以及 vite、@vitejs/plugin-react、tailwindcss、@tailwindcss/vite。`pnpm install` 时间与 lockfile 会变大；根包和 core 不新增依赖。
- **代码：**
  - 新增 `packages/report-view/`；
  - 删除 `viewer/`；
  - 修改 `skills/excavator-view/page-assembly.mjs`、`pack.mjs`、`SKILL.md`；
  - `scripts/view-smoke.mjs` 保留，就绪与计数约定不变；
  - 修改测试 `tests/skill/excavator-view/*` 与 `tests/skill/excavator/test_service_only_contract.test.mjs`。
- **查看页大小：** 模板估计 2–3 MB（ELK 约 1.6 MB 未压缩），加在数据之上。
- **不变：**
  - 产物格式、skill 的参数与最后回复；
  - 不联网、不起服务、只读 `.excavator/`；
  - 打开的人只需要浏览器。
