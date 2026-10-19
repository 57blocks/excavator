## Why

TypeScript/JavaScript 的事实不记录 JSX 元素。React 代码里组件的组合全写成 `<Button …>`，不是函数调用，于是事实图里没有一条边指向被渲染的组件。

2026-10-19 在 hadoop（`2014707f8c31`）的 `hadoop-yarn-capacity-scheduler-ui` 模块上做未使用代码验收时发现：
- `components/ui/button.tsx` 声明的 `Button` 被 38 个文件 import，并以 `<Button …>` 使用；
- 事实图里只有指向 `button.tsx` 的文件级 `imports` 边，没有任何 `calls` 或引用边指向函数节点 `Button`；
- 结果是 TypeScript 的 504 个函数节点全部是候选、334 个是没有引用者的入口，报告把它们全部判成未使用（0 high / 6 medium / 498 low），只靠名字普查挡在 `high` 之外；
- 所有读调用图的消费者（traverse、PRD 流程）都看不到 React 代码里的组件组合。

## What Changes

- **JSX 元素成为调用点。** TS/JS 抽取器记录每个开标签与自闭合标签 `<X>`、`<X.Y>` 写下的标签名与行号。
  - 内建元素（小写开头、带 `-`、带命名空间 `a:b` 的标签）只计数，不产生边。
  - 片段 `<>` 不是元素，不计。
  - 标签根名字被外层函数的参数或局部变量遮蔽时，标记出来，不按 import 解析。
- **按 import 绑定解析，生成 `calls` 边。** 事实图从标签的根名字出发：
  - 先找本文件的 import 绑定（具名、默认、命名空间），沿 import map 到仓库文件，再在该文件的导出里找名字；
  - 经过 `export … from` 与 `export * from` 的转发桶文件继续跟；
  - 本文件顶层声明的函数或类也可以是目标；
  - 唯一解析到一个函数或类节点、且恰好一个函数节点包含该元素时，生成从该函数指向组件的 `calls` 边，证据带 `token`（标签名原文）。
- **解析不了的落进可见 gap。** 五个新 gap 种类：`jsx-external`、`jsx-unbound`、`jsx-target-unresolved`、`jsx-ambiguous`、`jsx-caller-unresolved`。新增 `coverage.jsxElements`，元素与调用点逐个守恒，构建时 fail-closed 校验。
- **为解析补的结构事实（TS/JS，均为可选字段）：**
  - import 条目带 `bindings`（本地名 → 导出名 / `default` / `*`）；
  - `export … from` 语句同时记为 import 条目，带 `reexports`。桶文件因此获得指向被转发模块的 `imports` 边，这是对既有缺失的修正；
  - 导出条目在导出名与本地声明名不同的时候带 `local`（`export { X as Y }`、`export default class X`、新记录的 `export default X;`）。事实图的 `exports` 边按本地名解析。
- **import map 输出每个 TS/JS 源说明符解析到的文件**（`resolvedSources`）。
- **验证器**：`calls` 边的证据带 `token` 时按 `token` 核对证据行。默认导入换了本地名时，证据行上写的不是组件声明名。
- **未使用代码**：残余假设把 JSX 的五个 gap 与调用 gap 并列。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/13`，源码不变的已分析项目会重投影一次。

TS 普通调用仍按原规则（调用者文件加 import 目标里的同名声明）解析，不在本变更范围内。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增「TS/JS JSX 元素引用生成 calls 边」与「TS/JS 的 import 绑定、转发与本地导出名」两条需求。
- `graph-validation`：「锚点与证据触源码核对」中，`calls` 边的期望记号在证据条目带 `token` 时取 `token`。
- `unused-code`：「产物、新鲜度与查询」的残余假设加上 JSX 的 gap 种类。

## Impact

- `packages/core`：
  - `src/types.ts`：`StructuralAnalysis` 增加可选字段；
  - `src/plugins/extractors/typescript-extractor.ts`：import 绑定、转发、`local`；
  - 新文件 `typescript-jsx.ts`：JSX 元素与遮蔽判断；
  - 抽取器测试。
- `skills/excavator`：
  - `extract-structure-result.mjs`：校验并映射新字段；
  - `extract-import-map.mjs`：`resolvedSources`；
  - 新文件 `jsx-element-resolution.mjs`：解析器；
  - `build-fact-graph.mjs`：接入解析器，`exports` 按 `local`；
  - `validate-graph.mjs`：`calls` 的 `token`；
  - `unused-code.mjs`：残余假设；
  - `lazy-analyze.mjs`：版本号。
- 测试：
  - 核心抽取器夹具：自闭合、成员表达式、默认导入、转发桶、内建元素、遮蔽；
  - 解析器单测与守恒；
  - 一个跑真实 Lazy 驱动的 TSX 夹具项目；
  - 冻结的非 Java 行摘要整块重冻（TS 行合法变化）；
  - 版本号断言改为 `/13`。
- 依赖不变，build-free：不编译目标、不装运行时、不拉依赖。
