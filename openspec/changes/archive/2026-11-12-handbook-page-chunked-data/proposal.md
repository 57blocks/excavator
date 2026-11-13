## Why

`page` 把全部页面数据写成一段 JSON 内联在 `handbook.html` 里。一次真实运行 54 个功能时数据约 1.9 MB，没有问题；但数据随功能数与字典大小增长，大项目的产出可能到几百 MB 乃至 1 GB。到那时有两道硬墙：

- **写不出**：V8 单个字符串上限约 5.37 亿字符，整份数据 `JSON.stringify` 或拼进模板时直接失败，一次运行的页面就没有了。
- **打不开**：浏览器要把整份数据读进内存、一次解析；几百 MB 的单文件 HTML 打开就卡死或崩溃。

页面仍然必须双击就能从磁盘打开，不要服务器、Node 或网络；`file://` 下同目录的 `fetch` 会被浏览器拦掉，只能用 `<script>` 加载数据。

## What Changes

- **两种形态**：数据不超过阈值（32 MB）时，`handbook.html` 仍是一个文件，形态与现在相同；超过时写成 `handbook.html` 加同级目录 `handbook-data/`，里面是若干 `part-NNNN.js` 数据块。
- **核心与分块**：导航、概览与各汇总页需要的数据放在核心里，内联在 `handbook.html`；只在单个功能页或单个应用页显示的明细（功能条目的正文与源码位置、某个应用的字典与数据表等）放进分块。页面打开某一页时才插入 `<script>` 加载它需要的块，加载期间显示加载状态，加载失败写明哪一块缺失。
- **长表格分页**：超过 200 行的表格分页显示，不一次渲染全部行。
- **写出时不拼大串**：每块单独序列化、单独写文件，任何一步都不把整份数据变成一个字符串；每块不超过 8 MB。
- 数据格式升到 `/15`（核心 + 分块的索引）。

**不做：** `handbook.md` 的大小限制（拼装手册是另一处，本变更只记录它的上限）；其他产物（如知识图谱查看页）的分块；虚拟滚动。

## Capabilities

### Modified Capabilities

- `product-handbook`：HTML 导出。

## Impact

- `skills/excavator-product-handbook/lib/page.mjs`、`page-data.mjs`：分块与写出。
- `packages/product-handbook-page/src/lib/data.ts` 及用到条目明细、字典、数据表的组件：按需加载与分页。
- 模板的 CSP：分块形态需要 `script-src 'self'`。
- 页面与脚本的测试。
