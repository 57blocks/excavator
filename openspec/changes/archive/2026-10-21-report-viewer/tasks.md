## Commit 序列

0. `docs(openspec): propose report-viewer`：本变更的五个文件。
1. `feat(view): pack products into one page and open it with /excavator-view`：
   - `viewer/` 外壳：`index.html`、`styles.css`、`src/` 的数据解码、路由与 Overview；
   - `skills/excavator-view/pack.mjs`、`SKILL.md`；
   - `scripts/view-smoke.mjs`；
   - `service-only` 契约测试、安装测试与 README；
   - 1.1–1.6 的测试。
2. `feat(view): code page with embedded sources`（2.1–2.2）。
3. `feat(view): unused code page`（3.1）。
4. `feat(view): doc map page`（4.1）。
5. `feat(view): hotspots page`（5.1）。
6. `feat(view): reports page`（6.1）。
7. `docs(openspec): record report-viewer acceptance and archive`（7.1–7.5）。

每个 commit 自带测试，单独通过 O2；从 1 起，每个 commit 的夹具包都要过 O3 冒烟。

## 1. 打包、外壳与 skill

- [x] 1.1 `viewer/index.html`（CSP、`color-scheme: light`、`<!-- xv:data -->` 占位）与 `styles.css`（design D6 的 token）。验证：静态门测试通过——没有 `package.json`，没有 `import`/`require`，没有 `http(s):` 资源，没有危险 API，没有中文字符。
- [x] 1.2 `skills/excavator-view/pack.mjs <projectRoot> [--no-source] [--out <path>]`：按 design D2–D3 内联前端与产物、判定状态、比对版本、原子写，并在 stdout 打印结果 JSON。验证：单测覆盖四种状态（含损坏、未知 format、缺键、版本不同、没有版本字段）、字节级确定性、原子写与失败保留旧文件、CSP、恶意字符串不提前结束 `<script>`。
- [x] 1.3 `viewer/src/`：解码（`DecompressionStream`）、hash 路由、Overview 页、就绪信号与 `data-xv-count-*`。验证：`vm` 单测覆盖路由解析与 Overview 计数整理。
- [x] 1.4 `scripts/view-smoke.mjs <html>`：DevTools 管道、就绪等待、控制台错误、CSP 违规、网络请求与计数输出。验证：三个故意坏的页面各自报红，夹具包报绿（O3）。
- [x] 1.5 `skills/excavator-view/SKILL.md`：解析 `PLUGIN_ROOT`、运行打包、按平台打开、由一条命令打印固定格式的最后回复。验证：契约测试钉住打开命令、固定回复的行与「不起服务、不跑分析」。
- [x] 1.6 修改 `test_service_only_contract.test.mjs`（design D8）、`tests/install/install.test.mjs`（skill 数改为 14）、`README.md`。验证：`pnpm test` 与 `node scripts/check-refs.mjs` 通过。

## 2. Code 页

- [x] 2.1 打包按 design D4 收集被引用文件并分类，embedded 文件打成一个载荷。验证：单测覆盖五类、`--no-source` 下文件里没有源码文本、多仓路径前缀。
- [x] 2.2 Code 页：文件树、路径过滤、行号、`lines` 高亮、行号越界提示、分类计数与当前文件的分类。验证：`vm` 单测覆盖越界判断，冒烟里的夹具跳转高亮正确。

## 3. Unused code 页

- [x] 3.1 计数与守恒、判定表、明细表（按置信度、原因、语言筛选，任一列排序，每页 200 行）、testOnly、残余假设，每条位置链到 Code 页。验证：`vm` 单测——只选 high 时条数等于 `counts.byConfidence.high`；静态门扫建议性词组。

## 4. Doc map 页

- [x] 4.1 文档表、单元表（引文、查找状态、证据、核验结论；没有核验记录的显示「未核验」）、not-found 单元的 `searched`、coverage 按目录与按文件、读不了的文件、残余假设。验证：`vm` 单测——没有 `checks.json` 时全部是「未核验」，`checks.json` 损坏时整个 doc-map 是 unreadable（打包单测）。

## 5. Hotspots 页

- [x] 5.1 窗口与历史说明、文件表与目录表（默认按分数）、按年提交与集中度（缺字段显示「产物未提供」）、同改文件对、功能分组、残余假设。验证：`vm` 单测——缺 `commitsByYear` 的旧产物显示「产物未提供」而不是 0。

## 6. Reports 页

- [x] 6.1 零依赖 Markdown 渲染器（标题、段落、列表、表格、代码块、行内代码、强调），HTML 一律当文字。验证：`vm` 单测——含 `<script>` 与 `<img onerror>` 的报告渲染成文字节点。

## 7. 验收

- [x] 7.1 O2 全量门：三件套、`check-refs`、`openspec validate --all --strict`。
- [x] 7.2 O1 注入变异逐一先红后绿，记录结果。
- [x] 7.3 O4：在 go-multirepo 上跑 Lazy、hotspots、unused-code 与 doc-map，打包并冒烟；完成总数比对、20 个分层跳转抽查、not in snapshot 为 0 的检查；记录大小与耗时；截三张图。
- [x] 7.4 O5：`claude -p --model sonnet` 跑 `/excavator-view`，核对文件、回复的行、其余产物 mtime 不变与打开命令。
- [x] 7.5 在 design.md 末尾写验收记录，同步主规范，归档本变更。
