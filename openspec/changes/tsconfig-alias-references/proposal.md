## Why

一次产品手册试点测量了事实图能否替写作代理预先备好阅读材料，其中一个发现是：前端文件经路径别名的 import 没有 `imports` 边。一个前端文件 import 了 3 个相对路径模块和约 8 个 `src/...` 别名模块，事实图里只有那 3 条相对路径的边。

原因在 `extract-import-map.mjs` 的 tsconfig 加载：它只读文件名恰好是 `tsconfig.json` 的配置，只取这个文件自己的 `compilerOptions`，不跟随 `references`，也不跟随 `extends`。Vite 的 React 模板正是这种布局：根 `tsconfig.json` 只有 `"files": []` 和 `"references": [{ "path": "./tsconfig.app.json" }, …]`，`baseUrl` 与 `paths` 写在 `tsconfig.app.json` 里。于是整个前端的别名 import 都落进 `imports-unresolved`，像外部包一样。同一个缺口也出现在 `extends` 一份共享基础配置的 monorepo 里（别名写在 `tsconfig.base.json`）。

## What Changes

- **跟随 `references`**：每个 `tsconfig.json` 除了自己的别名，还带上它 `references` 里每个配置的别名（引用可以是配置文件，也可以是含 `tsconfig.json` 的目录）。被引用的配置从磁盘读，不要求出现在文件清单里。一个被引用配置的别名只用于它自己目录之内的文件。
- **跟随相对路径的 `extends`**（字符串或数组）：`baseUrl` 与 `paths` 按 TypeScript 的规则继承，各自锚定在写出它的那个配置的目录。写成包名的 `extends` 不跟随。
- **歧义可见**：两个配置把同一个说明符解析到不同的文件时，不画边，这个说明符进 import map 新的 `ambiguous` 桶（带候选文件），不再同时进 `unresolved`；覆盖账本据此产出新缺口 `imports-ambiguous`。解析到同一个文件不算歧义。
- **跟随不了的条目只告警**：`extends` 或 `references` 指向不存在的文件、离开项目根目录、`extends` 成环，都只写 Warning:；存在但读不了、解析不了的配置照旧记 `failures`。
- **增量运行**：import map 输出 `tsConfigFiles`（构建别名时读过的全部 tsconfig 文件）；增量运行发现其中任何一个被改动时，整张 import map 重算。

**不做**：
- 不按 `include` / `files` / `exclude` 判断一个文件归哪个配置；用「被引用配置的目录」近似（见 design）。
- 不跟随引用的引用；不读包里的配置。
- 前端到后端的 HTTP 调用边（试点的另一个发现）不在本变更内。

## Capabilities

### Modified Capabilities

- `fact-graph`：新增「TS/JS 路径别名跟随 tsconfig 的 `references` 与 `extends`」。
- `coverage-ledger`：「覆盖表与缺口表进发布图」加缺口 `imports-ambiguous`。

## Impact

- `skills/excavator/extract-import-map.mjs`、`skills/excavator/coverage-ledger.mjs`、`skills/excavator/prepare-incremental.mjs`。
- 测试：`tests/skill/excavator/test_extract_import_map.test.mjs`、`test_coverage_ledger.test.mjs`、`test_prepare_incremental.test.mjs`。
- 只有 `tsconfig.json` 自己的别名、没有 `references` 与 `extends` 的项目，解析结果不变。
