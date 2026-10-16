## Why

Excavator 的全部产物只存在于 `.excavator/` 下的 JSONL / JSON，唯一的消费端是终端问答。没有装插件、没有 Node 环境的人——评审者、客户、演示观众、不跑分析的同事——看不到分析结果；要展示「Excavator 找到了什么」只能截终端。需要一个人人可直接打开的产物：一个 HTML 文件，双击即开，不装任何东西、不联网、不起服务。

上游的 dashboard 在 service-only-runtime（2026-09-14 归档）被整体删除，删的是运行时：Vite 开发服务器、带 token 的本地 HTTP viewer、`--with-dashboard` 之类的展示旗标、tour 生成器。本变更不恢复其中任何一项：产物是一个由确定性脚本写出的静态文件，打开它的人只需要浏览器。

本机实测（2026-10-13）给出的硬约束：

- `file://` 下页面不能 `fetch` 同目录文件，不能加载外链的 module 脚本，`@font-face` 过不了 CORS；内联脚本、内置 gzip 解压（`DecompressionStream`）、blob Worker、目录拖入、同目录的传统 `<script src>` 都可用。所以数据必须嵌进 HTML，或由用户把目录拖进页面。
- 图谱 JSONL 的体积几乎全是重复的长字符串 id 与证据结构。流式转成字符串驻留的列式数据后：wcp 16 MB → 嵌入 0.4 MB；hadoop 555 MB（15.5 万节点、77 万边、167 条缺口）→ 嵌入 8.1 MB，转换 2.9 秒，Node 峰值 485 MB。1 GB 的图按线性外推约 15 MB。页面侧一个带 60 MB 内联数据块的 HTML 在 Chrome 里 0.4 秒到脚本可执行。

## What Changes

- 新增工作区 `packages/view`：React + Vite 构建的单文件页面模板 `dist/index.html`，JS、CSS、字体全部内联，带一个数据占位。构建产物不提交，与 `packages/core/dist` 一样按需构建。
- 新增 skill `excavator-view`：流式读取 `.excavator/` 里存在的产物，编成列式数据包，gzip + base64 注入模板，原子写出 `.excavator/view.html`，用宿主的系统打开器打开。旗标：`--no-source`（不嵌任何源码原文）、`--raw`（数据不压缩，给没有 `DecompressionStream` 的浏览器）、`--no-open`、`--out <path>`、`--source-budget <MB>`。skill 零模型调用，只写这一个文件。
- 页面按产物清点渲染，不区分 Lazy 与 Full：总览、结构 treemap、图谱探索、覆盖与缺口、搜索必有；摘要与标签、architecture layers、领域流只在对应产物存在时亮起，缺失处明示「未生成」及生成命令；每条语义按 hash / digest 逐项标新鲜或过期。页面不发任何网络请求（内容安全策略关闭网络），支持把 `.excavator/` 目录拖入页面读取。
- 规模：烘焙逐行流式进行，内存只随输出增长；header、节点、边、覆盖、缺口必嵌；证据行原文与符号源码片段受预算约束，按固定顺序裁剪并在页面可见；超过硬上限以具名错误失败且不写文件。
- **BREAKING**（对 spec 与门禁而言）：`service-only` 的「Service-only distribution」从「不带 HTML 应用」改为「不带运行时、不起服务、不带展示旗标；允许写出静态自包含 HTML 并交给系统打开器」；安装测试的 skill 数 10 → 11；service-only 契约测试与读图 skill 的新鲜度测试相应更新。既有产物格式、Core、MCP 工具面不变。
- README 与 docs 更新：去掉「不发布 HTML 界面」的表述，补 `/excavator-view` 的用法、分享说明与浏览器要求。

## Capabilities

### New Capabilities
- `artifact-view`：静态自包含查看器产物的契约——单文件与零依赖、按产物清点渲染且缺失可见、逐项新鲜度、规模预算与具名失败、烘焙自检后才写出、源码嵌入可选、拖入目录、探索与定位、view skill 的行为。

### Modified Capabilities
- `service-only`：「Service-only distribution」改为禁止运行时、服务与展示旗标，而不是禁止一切 HTML 产物；安装场景的 skill 数与「打开静态视图」场景更新。
- `consumer-freshness`：「消费端按 sourceRevision 判新鲜度」列出的消费端加入 view skill。

## Impact

- 代码：新增 `packages/view/`（react、react-dom、vite、@vitejs/plugin-react、vite-plugin-singlefile、d3-force、d3-hierarchy、framer-motion、typescript）；新增 `skills/excavator-view/`（`SKILL.md`、`build-view.mjs`、`bundle-codec.mjs`、`FORMAT.md`，零 npm 依赖；页面经相对路径引入同一个 codec）；`tests/view/` 新增烘焙、编解码、构建与 `file://` 冒烟测试；修改 `tests/skill/excavator/test_service_only_contract.test.mjs`、`tests/install/install.test.mjs`、`tests/skill/excavator/test_skill_graph_freshness.test.mjs`。
- 构建：`pnpm -r build` 多出一次 Vite 构建；`pnpm run typecheck` 加 view 的 tsconfig；`pnpm install` 变重。`dist` 已在根 `.gitignore`。
- 产物：`.excavator/view.html` 只写不读，任何其它入口不消费它；它不属于 Lazy 的产物集合，Lazy 的发布与清理不碰它；重新烘焙原子覆盖。
- 文档：README、新增 `docs/view.md`。
- 不改：Core、MCP 工具面、任何既有产物的格式、`.excavator/` 之外的任何文件。
