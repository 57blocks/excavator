## Context

打包（`skills/excavator-view/pack.mjs`）在内存里拼出一个数据对象：产物文件名到内容，加上 `sources`（路径到源码）。`page-assembly.mjs` 把它整个 `JSON.stringify` 后写进 `<script type="application/json" id="xv-explorer-data">`，再由一行内联脚本 `JSON.parse(textContent)` 放到全局。页面读数据只走 `packages/explorer/src/offline/inlineData.ts`：`readInlineFile`、`readInlineSource` 返回 Promise，`hasInlineFile`、`hasInlineSource` 是同步的存在判断。启动时只读 `meta.json`、`config.json`、`knowledge-graph.json`、`diff-overlay.json`、`domain-graph.json`、`staleness.json`、`products.json`；unused-code、hotspots、doc-map 由 `productFiles.ts` 在视图打开时读一次并缓存。

实测（约 165 万行的 Java 仓库）：数据块 504 MB，最大的是知识图谱的 `edges`（215 MB，41 万条）、`nodes`（43 MB）、unused-code 的 `unused`（75 MB），全部是顶层数组；最大的单个源文件 0.97 MB。整块 gzip 后 38 MB。Chrome 能打开，JS 堆 1.36 GB。

## Goals / Non-Goals

**Goals:**
- 任何一个数据量下，页面与打包都不需要把超过切片上限的文字放进一个字符串。
- 文件体积随压缩下降；只看图时不为源码与没打开的产物付内存。
- 页面的其余代码不感知分块：读数据的接口与返回的内容都不变。

**Non-Goals:**
- 打包进程自身的内存：它仍把全部产物读进 Node 的堆。百万行级之上若撞到 Node 的堆上限，另开变更。
- 图本身在浏览器里的内存：知识图谱解开后仍整份在堆里，不做聚合或裁剪。
- `/excavator-prd-report` 的报告页：它的数据小，不改。

## Decisions

### D1 仍是一个 HTML 文件，不拆成目录或数据文件

`file://` 打开时 Chrome 拦下读取同目录文件的请求，内容安全策略也禁止一切连接，所以「HTML + 数据文件用 fetch 读」打不开。「HTML + 一组 `<script src>` 数据文件」能加载，但交付物变成目录，下载和转发都多一步，而且仍要切块才能避开单串上限。一个文件里放压缩块，两件事都解决。

### D2 块的写法

- 每块是一段 UTF-8 JSON 文字，gzip 压缩后 base64 编码，写进 `<script type="application/octet-stream" id="xv-part-<n>">`。base64 里没有 `<`，元素不会被内容提前关闭。
- 一个小的索引块 `<script type="application/json" id="xv-explorer-index">` 记录：每个数据文件按原字段顺序列出它的顶层字段，每个字段是数组还是单值、在哪些块里（按顺序）；每个源文件路径所在的块编号。拼回时按这个顺序建对象，字段顺序与打包时相同。页面靠索引回答 `hasInlineFile` / `hasInlineSource`，不解开任何块。
- `xv-explorer-manifest` 块不变：回复读它。

选 gzip 而不是 deflate-raw：浏览器的 `DecompressionStream('gzip')` 在 `file://` 下已实测可用，Node 的 `zlib.gzipSync` 头部时间写 0，输出可重复。

### D3 切分规则

- 切片上限 `PART_CHARS` 为 16 Mi 个字符（16,777,216），比 V8 单串上限（536,870,888）小 32 倍，留足浏览器与解析的余量。打包函数接受一个只给测试用的覆盖值。
- 产物文件：每个顶层数组都离开头块，按元素顺序累加成块，每块的 JSON 文字不超过 `PART_CHARS`，单个元素超过上限时自成一块；空数组没有块，索引记为空列表。其余顶层字段按顺序累加进头块，头块超过上限时从下一个字段起开新的头块；单个字段超过上限时自成一块。页面按索引把各头块的字段依次合回一个对象，再按原字段顺序放回各数组。产物内容不是对象时整份作为一个值，规则同单个字段。
- 不论数组大小都切出去：这样头块的大小只取决于非数组字段，不会因为几个中等数组相加而超过上限。
- 源码：按路径排序依次装块，每块是 `{ "<path>": <source entry> }` 的 JSON，不超过 `PART_CHARS`；单个文件超过上限时自成一块。
- 一个值（非数组顶层字段、单个数组元素、单个源码项）在 Node 里无法 `JSON.stringify` 成一个字符串（抛 `RangeError`）时，打包报错并写明产物与字段，按现有的失败路径不写出文件。
- 块编号按数据文件的固定顺序（打包已有的键顺序）再按块顺序递增，切分只取决于数据与 `PART_CHARS`，所以输出确定。

### D4 页面按需解开并缓存

`inlineData.ts` 改为从索引与块读取：
- `readInlineFile(name)`：第一次调用时解开该文件的头块与它的全部数组块，按索引顺序把数组拼回头块，缓存这个 Promise；之后的调用返回同一结果。
- `readInlineSource(path)`：解开该路径所在的块并缓存这一块；同一块里的其它文件之后直接取。
- `hasInlineFile`、`hasInlineSource`：只查索引。
- 解开：`atob` 得到字节，放进 `Blob`，经 `DecompressionStream('gzip')` 交给 `new Response(...).text()`，再 `JSON.parse`。全程不发请求，内容安全策略不用改。
- 现有的 `data` 参数（测试传入一个已解开的数据对象）保留为测试接缝：传入时直接读它，不走块。

### D5 页面按字节拼接

`assembleExplorerPage` 把模板前段、各块、模板后段作为 `Buffer` 依次拼接，不先拼成一个大字符串，避免页面整体超过单串上限时在打包这一步失败。

### D6 测试读回页面

`tests/skill/excavator-view/page.mjs` 的 `explorerPage(html)` 改为读索引、用 `zlib.gunzipSync` 解开各块、按 D3 拼回，返回与原来相同形状的 `data`。现有断言因此不用改写；新测试用很小的 `PART_CHARS` 让切分在小夹具上发生。

## Risks / Trade-offs

- [首次打开某个视图要等解压] → 只解开该产物的块；38 MB 的压缩数据整体解开在秒级，单个视图更少。验收时记录打开时间。
- [不同 zlib 版本的 gzip 字节不同] → 「重复打包逐字节相同」指同一台机器、同一份 Node；跨机器比的是解开后的内容（D6 的读回）。
- [`DecompressionStream` 不可用的旧浏览器] → 目标是当前 Chrome；页面读不到块时按现有的「读不了」状态显示原因，不显示空产物。
- [启动时有组件读了大产物，`只打开图` 的场景不成立] → 验收逐个检查启动后哪些块被解开；有就修读它的组件，或把这一点写回规格。

## Migration Plan

产物不变。对已有的 `.excavator/` 重跑 `/excavator-view`（不调用模型）即得新页面。回滚：revert 本变更的提交并重新 `pnpm build`、重新打包。

## 验收 oracle（动手前写死）

- O1 单元：在小夹具上用很小的 `PART_CHARS` 打包，断言产生多块、每块解开后的字符数不超过上限、读回的 `data` 与不切分时逐项相等；切不开的值让打包以非零状态退出且写明产物与字段。
- O2 页面单元：`inlineData` 的测试在 Node（自带 `DecompressionStream` 与 `atob`）里解开块，断言读回内容、缓存（同一文件只解一次）、`has*` 不解块。
- O3 真实页面：用前面那个约 165 万行 Java 仓库已有的 `.excavator`（不重新生成）重新打包，在 Chrome 以 `file://` 打开：图显示；Unused、Hotspots、Doc map 视图都能打开；能打开一个源文件并定位到行；没有控制台错误与 CSP 违规；记录文件体积与 JS 堆，与改前（508 MB、1.36 GB）对比；只看图时没有源码块被解开。
- O4 超上限：在临时目录造一个顶层数组使 JSON 超过 536,870,888 个字符的产物，打包成功，Chrome 打开后该视图显示。数据不提交。
- O5 确定性：同输入打包两次逐字节相同（现有测试保留）。
