## Context

页面是要被带走的产物，源码原文（含配置文件里的密码）随页面一起出去。改动只是把默认值反过来。

## Decisions

### D1 默认在命令行入口翻转，程序接口不动

用户与 skill 只经 `pack.mjs` 命令行打包，翻转命令行默认即覆盖全部真实入口。`packProject(root, { noSource })` 保持原样：几十个测试以「不传即内嵌」为前提调用它，翻转会把改动面扩到所有打包测试，却不改变任何用户可见行为。

代价：读代码的人看到 `packProject` 默认内嵌，与命令行默认相反。在 `parseArgs` 与 `packProject` 的注释里各写一句说明。

### D2 `--no-source` 保留为显式写法

删除它会让已有脚本与文档里的命令报 unknown option。它与默认相同，不影响安全性。`--source` 与 `--no-source` 同时出现时以后出现的为准，与常见命令行习惯一致，不报错。

### D3 不做内容脱敏

把嵌入原文与引文里的密码、连接串替换成占位符需要一套识别规则和替换计数，范围大得多，单独立变更。本变更只保证默认情况下页面里没有源码原文。

## 验收

- `node pack.mjs <root>`：`source.requested` 为 false，全部被引用文件在 `notEmbeddedOnRequest`，页面没有 `sources` 数据。
- `node pack.mjs <root> --source`：与改动前的默认结果相同。
- `--no-source` 与默认结果相同；`--no-source --source` 内嵌，`--source --no-source` 不内嵌。
