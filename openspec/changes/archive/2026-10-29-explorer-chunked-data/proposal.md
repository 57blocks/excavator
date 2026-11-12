## Why

离线页面把全部数据写成一个 JSON 块，打开时用一次 `JSON.parse` 读成一个字符串。V8 单个字符串最多 536,870,888 个字符：一个约 165 万行的 Java 仓库打出的页面数据块已有 504 MB（知识图谱 258 MB、源码 137 MB、unused-code 91 MB），到了上限的 94%；百万行级的目标项目会到 1 GB，页面会直接打不开，打包也会在把整份数据写成一个字符串时失败。同一份数据 gzip 后只有 38 MB。

## What Changes

- 页面数据改成按产物分开、按大小切片、gzip 压缩后的多个数据块，外加一个小的索引块；页面在第一次读某个产物时才解开它的块，源码在第一次打开某个文件时才解开它所在的块。
- 任何一块解开后的文字都不超过固定的切片上限，远低于 V8 的单串上限；产物里的顶层数组按元素切开，其它字段留在产物的头块里。一个切不开的值大到无法写成一个字符串时，打包以非零状态退出并写明是哪个产物的哪个字段，不写出文件。
- 页面仍是一个自包含的 HTML，双击即可打开；内容安全策略不变，不新增任何请求。
- 打包把页面按字节拼接写出，不再先拼成一个大字符串。
- 不改任何产物，也不需要重新生成 `.excavator/` 下的数据：对已有的产物重跑 `/excavator-view` 即得到新页面。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `report-viewer`：「打包成一个自包含的 HTML」——数据的写法改为压缩切片、按需解开，补上大数据与切不开的值两种情形。

## Impact

- 打包：`skills/excavator-view/page-assembly.mjs`、`skills/excavator-view/pack.mjs`、新增 `skills/excavator-view/data-chunks.mjs`；按行读知识图谱的 `skills/excavator-view/sources.mjs`、`skills/excavator-view/semantics.mjs` 与 `skills/excavator/jsonl-lines.mjs`（design D7）。
- 页面：`packages/explorer/src/offline/inlineData.ts`（读数据的唯一入口，调用方已是异步读取）。
- 测试：`tests/skill/excavator-view/`（读回页面数据的辅助函数改为解开数据块）、`packages/explorer/src/offline/__tests__/inlineData.test.ts`。
- 不涉及：产物格式、`/excavator-prd-report` 的报告页、其它 skill。
