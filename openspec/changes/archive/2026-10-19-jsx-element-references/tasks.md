提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入；全程 build-free）：

1. `docs(openspec): propose jsx element references`：proposal、specs、design、tasks。
2. `feat(core): record import bindings, re-exports and local export names`：任务 1.1、1.2。
3. `feat(core): record JSX elements in TS/JS structure`：任务 1.3、1.4。
4. `feat(skill): carry bindings, re-exports and JSX elements into structure results and the import map`：任务 2.1、2.2。
5. `feat(skill): check calls evidence by its token`：任务 2.7。先于解析器提交，使解析器提交里的夹具测试能直接过校验器。
6. `feat(skill): resolve JSX elements to calls edges with visible gaps`：任务 2.3–2.6。
7. `docs(skill): list JSX gaps among the unused-code residual assumptions`：任务 2.8。
8. `test(skill): pin one edge per caller-target pair for repeated JSX elements`：验收时补的规格条款（同一对合成一条边、证据取第一个调用点）的测试。
9. `docs(openspec): record jsx element references acceptance and archive`：任务 3.1–3.3。

## 1. core 抽取器

- [x] 1.1 `types.ts` 加可选字段：import 条目的 `bindings` 与 `reexports`，导出条目的 `local`，分析结果的 `jsx`；`pnpm run typecheck` 通过。
- [x] 1.2 TS 抽取器记录 import 绑定、`export … from` 转发（同时记为 import 条目）、导出的 `local`（含新记录的 `export default X;`）；抽取器测试覆盖具名、默认、命名空间、改名导出、`export *`、`export * as` 与 js 语法里的 `export { default as D } from`。
- [x] 1.3 新文件 `typescript-jsx.ts` 记录开标签与自闭合标签、内建元素计数、局部绑定标记；不计闭合标签与片段。
- [x] 1.4 抽取器测试在 tsx 与 javascript 两种语法上覆盖：自闭合、成员表达式、内建（小写、带 `-`、命名空间）、片段、带类型参数的标签、被参数 / 解构 / 局部变量 / `catch` / `for…of` 遮蔽、顶层元素；`.ts` 文件不产生 `jsx`。

## 2. skill

- [x] 2.1 `extract-structure-result.mjs` 校验并映射新字段，坏形状被拒绝；测试覆盖。
- [x] 2.2 `extract-import-map.mjs` 为 TS/JS 输出 `resolvedSources`；测试覆盖相对路径、`index`、tsconfig `paths` 别名与转发来源。
- [x] 2.3 新文件 `jsx-element-resolution.mjs`：根名字解析、导出链（显式转发、本地导出、`export *`、环路、歧义、外部）、成员段、调用者；单测逐个覆盖五个 gap 种类与成边。
- [x] 2.4 `build-fact-graph.mjs` 接入解析器：`calls` 边带 `token`，五个 gap 原因，`coverage.jsxElements`，守恒 fail-closed（用不一致的计数喂它，确认报错）；`exports` 按 `local` 找声明。
- [x] 2.5 TSX 夹具项目经真实 Lazy 驱动：自闭合、成员表达式、默认导入、转发桶、内建元素、遮蔽、第三方、顶层元素各自落到规格写的去向。
- [x] 2.6 `PIPELINE_VERSION` 升到 `lazy-fact-graph/13`，各测试的版本断言随之更新；冻结的非 Java 行摘要用生成器整块重冻。
- [x] 2.7 `validate-graph.mjs` 对 `calls` 按证据条目的 `token` 核对；测试：带 `token` 的边在含 `token` 的行上不被判矛盾，指向不含它的行时被判矛盾。
- [x] 2.8 `unused-code.mjs` 的残余假设列出五个 JSX gap 种类；测试钉住。

## 3. 验收与归档

- [x] 3.1 全量门：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`（新文件先 `git add -N`）。
- [x] 3.2 hadoop 克隆上按 design.md 的 O1–O7 验收，结果写进 design.md；产物不提交。
- [x] 3.3 归档变更并同步主规格。
