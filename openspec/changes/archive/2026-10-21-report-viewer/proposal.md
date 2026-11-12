## Why

Excavator 的产物（知识图谱头部与覆盖、unused-code、doc-map、hotspots）现在只能用 `jq` 读，或者看 skill 在对话里的汇报。想把结果给没有 Claude Code、没有 Node 的人看（产品、管理、客户方的工程师），只能复制终端文字。

需要一个只靠浏览器就能打开的查看页：双击一个 HTML 文件，不联网、不装任何东西，就能浏览这些产物，并能从任何一条记录跳到对应的源码行。

2026-09 的 `service-only-runtime` 删掉了从上游继承的 React Dashboard 与本地 HTTP Viewer。删除的理由（依赖面、构建时间、安装体积、要起服务）对本变更同样成立，所以这里不恢复它们，而是做一个零依赖的静态页：没有 npm 依赖，没有构建，没有服务进程。

## What Changes

- 新增独立前端项目 `viewer/`：纯 HTML、CSS 与原生 JavaScript（classic script），零 npm 依赖、零构建步骤。它不 import 仓库里的任何代码，也不被任何代码 import。
- 新增打包脚本 `skills/excavator-view/pack.mjs`：读 `.excavator/` 下的产物与源码快照里的源码，与 `viewer/` 的文件一起内联进一个自包含的 HTML，写到 `.excavator/view.html`。
- 新增 skill `/excavator-view`：运行打包脚本，再用系统默认浏览器打开写出的文件。
- 本变更的页面：
  - **Overview**：项目、版本、语言与框架、图谱计数、覆盖与缺口，以及每个产物的状态（已有、没跑过、读不了、与当前源码版本不同）；
  - **Unused code**、**Doc map**、**Hotspots**：各自产物的计数、明细表、筛选与排序；
  - **Code**：文件树与源码面板，按行号定位与高亮；三个产物页里的每条 file:line 都能跳到这里；
  - **Reports**：渲染已存在的 `hotspots-report.md` 与 `doc-map-report.md`。
- 视觉：只有浅色主题，配色取自 57blocks 官网的设计 token，不沿用上游 Dashboard 的主题；不引入任何外部字体、图标或脚本。
- 页面只陈述产物里的事实，不给建议。例如 unused-code 页不出现「可以删除」之类的措辞。
- **BREAKING（规范层面）**：修改 `service-only` 规范。仍然没有 HTML 应用、HTTP 服务、展示模式开关，分析类 skill 也不打开浏览器；新增一个例外：`/excavator-view` 可以写出静态 HTML 并用系统默认浏览器打开它。对应契约测试同步修改。
- 不做（下一个变更）：结构图谱视图（按层或目录下钻、节点详情、路径查找）、Domain 视图，以及 hotspots、unused、doc 覆盖在图上的叠加层。
- 不做：拖入 `.excavator` 目录的加载方式、深色主题、多语言界面（界面只用英文；产物里的文字原样显示）、语法高亮。

## Capabilities

### New Capabilities

- `report-viewer`：零依赖静态查看页。包括打包（产物与源码的收集、内联、各种缺失的可见分类、与源码版本的比对）、页面（Overview、三个产物页、Code、Reports）、打开方式与安全边界（CSP、不联网、不执行产物内容）、只陈述不建议，以及 `/excavator-view` skill。

### Modified Capabilities

- `service-only`：「Service-only distribution」要求加一个例外。`/excavator-view` 可以写出自包含的静态 HTML 并交给系统默认浏览器打开；仍然禁止 HTTP 服务、展示模式开关与 Dashboard skill，分析类 skill 仍然不打开浏览器。

## Impact

- 新文件：
  - `viewer/`（`index.html`、`styles.css`、`src/*.js`）
  - `skills/excavator-view/SKILL.md`、`skills/excavator-view/pack.mjs`
  - `scripts/view-smoke.mjs`：用本机 Chrome 无头打开 `file://` 页面的零依赖冒烟脚本
  - 对应测试
- 修改：
  - `openspec/specs/service-only/spec.md`（经本变更的 delta）
  - `tests/skill/excavator/test_service_only_contract.test.mjs`
  - `tests/install/install.test.mjs`：skill 数从 13 改为 14
  - `README.md`：命令列表
- 依赖：不新增任何 npm 依赖。打包只用 Node 自带模块与现有的 `source-snapshot`、`knowledge-graph-store`；冒烟脚本只需要本机已装的 Chrome，不进 `pnpm test`。
- 产物：`.excavator/view.html` 内嵌源码，文件大小随项目增长。`--no-source` 可以不嵌源码。
