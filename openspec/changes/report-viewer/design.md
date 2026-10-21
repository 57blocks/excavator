## Context

- 动机见 proposal.md。行为契约见 `specs/report-viewer/spec.md`，`service-only` 的修改见 `specs/service-only/spec.md`。
- 2026-10-13 在 `file://` 下实测过（Chrome 无头）：
  - 能用：内联 classic 与 module 脚本、`DecompressionStream('gzip')`、blob Worker、同目录 classic `<script src>`；
  - 被拦：`fetch()` 同目录文件、外部 module 脚本；相对路径的 `@font-face` 也加载失败。
  - 所以数据只能内联进页面，前端源文件只能是 classic script。
- 产物的版本字段：
  - `hotspots.json` 与 `unused-code.json` 用 `sourceRevision`；
  - `doc-map.json` 用 `code.revision`；
  - 知识图谱用同目录 `source-manifest.json` 的 `sourceRevision`。
  - 它们都与 `resolveSourceSnapshot(root).revision` 同一格式（如 `git:<sha>`）。
- 量级：go-multirepo 有 2,357 个跟踪文件，知识图谱约 16 MB。
- 内置浏览器面板对 `file://` 页面只显示静态快照、不执行脚本，所以验证只能用本机 Chrome 无头。

## Goals / Non-Goals

**Goals：**
- 一个文件、双击能开、断网能用；页面上的每个数字都能追到产物字段。
- 打包的每个判断（产物状态、源码分类、版本比对）都在 Node 里完成并可单测；浏览器侧只做解码、显示、筛选与排序。

**Non-Goals：**
- 不做图谱可视化（下一个变更）。
- 不做浏览器侧的产物校验：没有「拖入目录」的加载方式，产物状态全由打包决定。
- 不支持旧浏览器。依赖 `DecompressionStream`：Chrome 80+、Edge 80+、Firefox 113+、Safari 16.4+。

## Decisions

### D1 前端是 classic script，挂在一个全局命名空间上

`viewer/` 的结构：
- `index.html`：外壳与 CSP；
- `styles.css`；
- `src/*.js`：每个文件是一个 IIFE，只往 `window.XV` 上挂东西，加载顺序由 `index.html` 里 `<script src>` 的顺序决定。

不用 ES module：外部 module 脚本在 `file://` 下被拦；把多个 module 内联成一个文件，要么靠打包器，要么自己剥 `import`/`export`，前者违反零依赖，后者脆弱。

可测性：Node 测试用 `vm` 建一个带最小 `window` 的上下文执行这些文件，再调用 `XV` 上的纯函数（解码后的数据整理、筛选、排序、hash 路由解析、Markdown 渲染）。DOM 相关部分只在冒烟里验。

### D2 打包只做替换与内联，不做转换

`pack.mjs` 读 `viewer/index.html`：
- 把 `<link rel="stylesheet" href="styles.css">` 换成 `<style>`；
- 把每个 `<script src="src/x.js">` 按原顺序换成内联 `<script>`；
- 在 `<!-- xv:data -->` 处插入数据块。

不压缩、不改写源码，页面里执行的代码就是 `viewer/` 里的代码，出问题能直接对上行号。

数据块有两类：
- **清单** `<script type="application/json" id="xv-manifest">`，内容是：
  - 每个产物的状态、原因与版本；
  - 快照版本；
  - 源码分类计数与每个文件的分类；
  - 单文件上限。
  
  JSON 里的 `<` 一律写成 `<`，内容不可能提前结束 `<script>`。
- **载荷** `<script type="application/octet-stream" id="xv-<name>">`：一个产物或一份源码集合，内容是 `base64(gzip(原始字节))`。base64 字符集里没有 `<`。

浏览器侧用 `DecompressionStream('gzip')` 解码。

确定性：
- `zlib.gzipSync` 的头部 mtime 固定为 0；
- 源码按路径排序；
- 清单键按固定顺序写；
- 不写打包时间。

### D3 产物状态在打包时判定

格式白名单：

| 产物 | 文件 | `format` |
|---|---|---|
| knowledge graph | `knowledge-graph.jsonl` | `excavator-knowledge-graph-lines/1` |
| unused-code | `unused-code.json` | `excavator-unused-code/1` |
| doc-map | `doc-map.json` | `excavator-doc-map/1` |
| hotspots | `hotspots.json` | `excavator-hotspots/1` |

`doc-map/checks.json` 是 doc-map 的附属文件。它不存在时，doc-map 仍是 included，所有单元显示为「未核验」；它存在却读不了时，doc-map 整体是 unreadable。理由：核验结论是同一产物的一部分，不能一半可信一半不可信。

必需字段只查页面要读的顶层键，例如 unused-code 的 `counts`、`unused`、`decisions`。缺任何一个，就是 unreadable，原因写出缺的键名。

报告 Markdown 不做格式检查，状态只有 included 与 not run。

版本比对：产物版本与 `snapshot.revision` 逐字比较，不同即 different revision；产物没有版本字段时注明「没有记录版本」。

### D4 被引用文件的收集与分类

被引用路径是下列来源的并集：
- `unused[].file`、`testOnly[].file`；
- doc-map 单元的 `code.evidence[].file`，以及 `coverage` 里按文件列出的路径；
- hotspots 的 `files[].path`、`pairs[].a/b`。

本变更不收集知识图谱的文件节点，下一个变更做图谱视图时再加。

每个路径按顺序落进第一个命中的类：
1. **not embedded on request**：给了 `--no-source`；
2. **not in snapshot**：快照的 `listFiles()` 里没有这个路径；
3. **binary**：前 8 KiB 里有 NUL 字节；
4. **too large**：超过 1 MiB，与已删除的上游 Viewer 的上限相同；
5. **embedded**。

上限只决定是否内嵌，超限的文件仍然可见、可计数，不会悄悄丢掉。

所有 embedded 文件打成一个载荷：一个 JSON，路径到文本的映射，键排序。go-multirepo 的源码估计 gzip 后在 10 MB 以内，量级在验收里实测并记录。

### D5 浏览器侧

- **路由**用 hash：`#/overview`、`#/unused`、`#/doc-map`、`#/hotspots`、`#/code?path=<p>&lines=<a>-<b>`、`#/reports/<name>`。浏览器的后退可用，链接可以复制。
- **长表格**每页 200 行，页脚写「第 x–y 行，共 n 行」，不做虚拟滚动。筛选与排序作用于全部行，不只当前页。
- **只当文字**：不用 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write`、`eval`、`new Function`，也不用内联事件属性。静态测试扫 `viewer/` 来钉住。Markdown 渲染器逐块建 DOM 节点，文字一律用 `textContent`。
- **就绪信号**：渲染完成后在 `<html>` 上写 `data-xv-ready="1"`，并把每页显示的总数写成 `data-xv-count-*`，供冒烟与验收比对。

### D6 主题

取自 57blocks 官网（2026-10-21 抓取其 CSS 的 `:root`），只用浅色：

| token | 值 | 用途 |
|---|---|---|
| `--paper` | `#EDEDEF` | 页面背景 |
| `--paper-2` | `#E2E2E6` | 侧栏、表头、代码面板背景 |
| `--surface` | `#FFFFFF` | 卡片与表格背景（官网 `--bs-body-bg`） |
| `--ink` | `#0C0C0E` | 标题 |
| `--ink-soft` | `#26262B` | 正文 |
| `--muted` | `#6C6C73` | 次要文字 |
| `--line` | `rgba(12,12,18,.07)` | 细分隔线 |
| `--line-2` | `rgba(12,12,18,.22)` | 强分隔线、输入框边框 |
| `--accent` | `#6A4DFF` | 链接、选中、主按钮、高亮行左边框 |
| `--violet` | `#7C5CFF` | 悬停 |
| `--cyan` | `#46C7FF` | 第二序列色（图表与徽章） |
| `--success` | `rgb(46,160,105)` | found、does、守恒成立 |
| `--warning` | `#ffc107` | different revision、medium |
| `--danger` | `#dc3545` | unreadable、not、high |

其余约定：
- 圆角：按钮与徽章用 999px 胶囊，卡片用 12px；
- 卡片阴影：`inset 0 1px 0 rgba(255,255,255,.7), 0 24px 60px -34px rgba(22,16,52,.5)`；
- 高亮行背景：`rgba(106,77,255,.10)`。

字体：
- 正文 `"Geist", system-ui, -apple-system, "Segoe UI", sans-serif`；
- 等宽 `"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`；
- 不内嵌字体文件：会带进字体许可与二进制体积，不嵌也照样能显示。

`<meta name="color-scheme" content="light">`，不写任何 `prefers-color-scheme` 分支。

### D7 skill 与打开方式

`skills/excavator-view/SKILL.md` 沿用其他 skill 的 `PLUGIN_ROOT` 解析，然后：
1. `node "$PLUGIN_ROOT/skills/excavator-view/pack.mjs" "$PROJECT_ROOT" [--no-source] [--out <path>]`；脚本把结果 JSON 打到 stdout；
2. 按平台调用 `open`、`xdg-open` 或 `cmd.exe /c start ""`；
3. 用一条命令打印固定格式的最后回复。如果分几条命令打印，模型会把上一条命令的结果播报并进回复。

回复语言固定为英文，不设 `--language`：回复只有路径、大小与状态词。

`pack.mjs` 放在 skill 目录，`import ../excavator/source-snapshot.mjs`，与 `excavator-domain/domain-freshness.mjs` 的做法相同。`viewer/` 放在仓库根目录，作为独立的前端项目，插件的两种安装方式都会带上它（目录 marketplace 拷整个仓库；install.sh 链接整个仓库）。

### D8 契约测试的改法

`test_service_only_contract.test.mjs`：
- 保留：`packages/dashboard`、`packages/viewer`、`skills/excavator-dashboard`、tour-builder、缩略图的不存在断言，以及分析类 skill 不得出现 `dashboard`。
- 新增断言：
  - `viewer/` 下没有 `package.json`，没有 `import`/`require`，没有 `http:`/`https:` 资源引用；
  - `pack.mjs` 与 `SKILL.md` 里没有 `createServer`、`listen(`；
  - 其他 skill 的 `SKILL.md` 都不引用 `/excavator-view`。

## Oracles

验收只用 go-multirepo：用户限定这次只用这个语料。查看页只读、不改产物，风险低，所以只做以下检查。

- **O1 单测（`pnpm test`）。** 以下每条用注入变异先证明测试会红，再证明实现会绿；结果记进验收记录。
  - 打包：
    - 四种产物状态，含损坏 JSON、未知 `format`、缺必需键、版本不同、没有版本字段；
    - 五种源码分类；
    - 字节级确定性；
    - 原子写，失败时旧文件不变；
    - `--no-source` 下没有源码文本；
    - CSP 存在且内容正确；
    - 恶意字符串（`</script>`、`<img onerror>`）不会提前结束 `<script>`。
  - 前端纯函数：筛选计数、排序、hash 路由、Markdown 渲染器把 HTML 当文字。
  - 静态门：
    - `viewer/` 零依赖；
    - 没有危险 API；
    - 源码里没有中文字符；
    - 页面文字里没有建议性词组（`safe to delete`、`can be deleted`、`should be removed`、`recommend`）。
- **O2 全量门。** `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`。
- **O3 冒烟装置先验。** `scripts/view-smoke.mjs` 用 DevTools 管道驱动本机 Chrome 无头打开 `file://`，等 `data-xv-ready`，收集控制台错误、`securitypolicyviolation` 与网络请求（主文档以外）。
  - 先打包三个故意坏的页面，装置必须对每个都报红：一个 `fetch('x.json')`、一个抛错、一个内联 `onclick`。
  - 然后对含恶意字符串的夹具包报绿，且每页的 `data-xv-count-*` 等于夹具的期望值。
- **O4 真实语料 go-multirepo。**
  - 先跑 Lazy、`/excavator-hotspots`、`/excavator-unused-code`、`/excavator-doc-map`（文档目录用语料里现有的一个文档目录），再打包并冒烟。
  - 每页总数与独立 `jq` 计算逐一相等。
  - 分层抽查 20 个跳转：Code 页打开的文件与高亮行必须与产物一致。
    - unused：每个置信度 × 每种原因各 2 条；
    - doc-map：found 5 条、not-found 3 条；
    - hotspots：前 3 个文件，再随机 3 个同改文件对。
  - fresh 产物下 not in snapshot 必须为 0。
  - 记录文件大小、打包耗时、页面就绪耗时。
  - 截图 1280 与 768 宽各一张，外加深色模式模拟下的一张（必须仍是浅色），人工看布局。
- **O5 skill 真实运行。** `claude -p --model sonnet` 在 go-multirepo 上跑 `/excavator-view`：
  - 文件写出；
  - 最后回复的行与 D7 一致；
  - `.excavator/` 里除 `view.html` 外的文件 mtime 不变；
  - 打开命令被调用过（查 transcript）。

## Risks / Trade-offs

- **[文件大]** 内嵌源码的大项目可能到几十 MB，打开要几秒。→ 用 `--no-source` 可以只看产物；O4 记录真实大小与就绪耗时，作为下一个变更的基线。
- **[页面内含源码]** 文件转发出去就等于把源码转发出去。→ skill 的最后回复固定写明是否内嵌了源码。这是陈述事实，不是建议。
- **[多仓路径前缀]** 产物路径与快照路径都应带成员仓前缀。如果有不一致，会表现为大量 not in snapshot。→ O4 要求 fresh 产物下为 0，否则就是缺陷。
- **[产物格式升级]** 产物 `format` 一升级，查看页就把它判为 unreadable。→ 这是有意为之：宁可看得见「不认识」，也不按旧结构猜。升级产物格式的变更要同时更新白名单。
- **[`service-only` 的边界松动]** 允许一个 skill 打开浏览器。→ 范围钉死在 D8 的契约测试里：只此一个 skill、不起服务、分析类 skill 不引用它。
