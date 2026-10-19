## Context

现状见 proposal.md 的 Why。和本设计有关的现有机制：
- TS/JS 抽取器记录顶层函数（函数声明与顶层 `const x = 箭头函数/函数表达式`）、类（方法只有名字，没有方法节点）、import 条目（来源、本地名列表、行号）与导出条目（名字、行号、是否默认）。
- 非 Java 的 `calls` 解析：被调用者文本原样匹配调用者文件与它的 import 目标文件里的同名声明。默认导入换名、`<UI.Button>`、经桶文件的导入，这条规则都解析不了。
- import map 只给出每个文件解析到的目标文件列表，不给「哪个说明符解析到哪个文件」。
- 事实图是纯投影，不读源码；不能唯一解析的引用进 gap。

## Goals / Non-Goals

**Goals:**
- 每个 JSX 元素恰好一个去向：一条 `calls` 边，或五个 `jsx-*` gap 之一，或计入内建元素。
- 解析只走 import 绑定与导出链，不按名字在全仓猜。

**Non-Goals:**
- 不改 TS 普通调用的解析（可以复用本变更的绑定解析，另立变更）。
- 不覆盖作为值传递的组件：`icon={Foo}`、路由配置里的 `Component: Home`、`lazy(() => import('./X'))`、`memo` / `forwardRef` 的结果、`React.createElement(X)`、CommonJS `require` 绑定。
- 不给类组件的方法建节点。写在类方法里的元素没有函数节点作调用者，落进 `jsx-caller-unresolved`。
- 不改未使用代码的候选定义。候选是从路由不可达的函数节点；TS 没有路由，模块的候选数不会因本变更减少。本变更减少的是入口（没有引用者、要模型决定的候选），以及按同一组决定得出的未使用节点。

## Decisions

- **D1 边类型用 `calls`。**
  - JSX 元素在运行时就是把组件函数交给渲染器调用；`calls` 是所有消费者（未使用代码、traverse、PRD 流程）已经读的边，不用改消费者。
  - 备选：新边类型 `renders`。要改 schema，每个消费者都要显式接入；未使用代码只把函数到函数的 `calls` 算作引用，不接入就等于没修。
  - 代价：traverse 上组件组合与函数调用不分。证据条目带 `token`，需要区分时可以按它区分。
- **D2 按 import 绑定解析，不复用按名字匹配。**
  - 按名字匹配解析不了默认导入换名、命名空间成员与桶文件；两个导入文件声明同名组件时还会给出歧义。
  - 绑定解析需要「说明符解析到哪个文件」：在 import map 里加 `resolvedSources`，复用它已有的解析（相对路径、扩展名与 `index`、tsconfig `paths` 别名），不在事实图里再解析一次说明符。
- **D3 抽取在 core，解析在 skill 的纯模块。**
  - 标签名、行号与遮蔽要看 AST，放在 TS 抽取器（新文件 `typescript-jsx.ts`）。
  - 解析只读结构结果与 import map，放进新文件 `skills/excavator/jsx-element-resolution.mjs`，事实图仍是纯投影；解析器单独可测。
- **D4 内建元素按 React 的规则判断，只计数。**
  - 小写开头、带 `-`、带命名空间的标签由渲染器当作宿主元素处理，不引用仓库代码，所以不进 gap。
  - 成员表达式从不是内建元素（`<motion.div>` 的根 `motion` 是导入的值），按绑定解析，通常落进 `jsx-external`。
- **D5 遮蔽偏向多标。**
  - 少标会让被参数遮蔽的 `<Icon />` 解析到同名导入，是错边；多标只把元素推进 `jsx-unbound`，可见。
  - 按函数作用域收集绑定：参数与解构里的名字（跳过默认值右侧与对象键）、`const/let/var` 声明的名字、局部函数与类、`catch` 参数、`for…in/of` 左侧。块内声明并入外层函数（多标）。
- **D6 导出链按 ES 模块规则，不设深度上限。**
  - 先显式转发，再本地导出，最后 `export *`；默认导出不经 `export *` 转发；`export *` 给出多个不同目标即歧义。
  - 环路由已访问集合截断。不设深度上限：上限能被构造抵达就是漏。
- **D7 `export … from` 同时记为 import 条目。**
  - import map 因此用同一个解析器解析转发来源，不另写一份。
  - 副作用：桶文件获得指向被转发模块的 `imports` 边，转发来源解析不了时进 import map 的 unresolved。这是对既有缺失的修正，不是回归。
- **D8 导出条目带 `local`。**
  - 默认导出要定位到声明：`export default function X` 已记为名字 `X`；`export default class X` 记为 `default`，`export default X;` 原来不记。补上 `local` 后，解析器与 `exports` 边都按本地名找声明。
  - `export default memo(X)` 一类匿名默认导出仍不记，经它的元素落进 `jsx-target-unresolved`。
- **D9 调用者用行范围包含，不退到类或文件节点。**
  - 未使用代码只把函数到函数的 `calls` 算作引用；以类或文件作调用者的边不改变它的结果，又让 `calls` 的端点含义变杂。
  - 顶层元素（路由表、列定义）与类方法里的元素进 `jsx-caller-unresolved`，可见。
- **D10 守恒 fail-closed。** `coverage.jsxElements` 的调用点数 = 成边的调用点数 + 五个 gap 数，且每个 gap 数与 gaps 里的计数相等；不成立时构建退出。测试用不一致的计数喂它，确认它会报错。
- **D11 版本号升到 `lazy-fact-graph/13`。** 抽取结果的形状变了，源码没变的已分析项目也要重新抽取与投影。

## Risks / Trade-offs

- 作为值传递的组件仍没有边（见 Non-Goals）。React Router 的路由配置、图标属性、懒加载都属此类，未使用代码的残余假设已覆盖「事实图没能解析的引用」，但这些写法不进 `jsx-*` gap，因为它们不是 JSX 元素。
- 遮蔽多标会把少数本可解析的元素推进 `jsx-unbound`。
- `forwardRef` / `memo` 包装的组件没有函数节点，指向它们的元素进 `jsx-target-unresolved`。
- 类组件作目标时边是函数到类，未使用代码不计入引用；traverse 可以走到。
- 同一调用者对同一目标的多个元素合成一条边，图里只留第一个调用点的证据；该对已有普通调用生成的 `calls` 边时沿用那条边（证据不带 `token`）。各调用点仍计入 `coverage.jsxElements.edge`。这与普通调用按对去重一致。
- 测试文件里的元素多写在 `it(...)` 回调里，回调没有函数节点，落进 `jsx-caller-unresolved`。测试代码因此不给组件提供引用者；未使用代码本来也要求测试入口另行判定。

## 验收 oracle

运行前写定，运行后填结果。语料：hadoop `2014707f8c31` 的 scratchpad 克隆，模块 `hadoop-yarn-project/hadoop-yarn/hadoop-yarn-capacity-scheduler-ui`（下称模块）。先 rebuild core，再跑 `lazy-analyze` 与 `unused-code candidates`。基线是本变更之前的同一流程（模块候选 510：TS 504、JS 6；入口 335：TS 334、JS 1；`Button` 是入口，0 个引用者）。

- **O1 候选数不变。** 模块候选仍是 510（候选定义见 Non-Goals）。
- **O2 `Button` 不再是入口。** `button.tsx` 的 `Button` 有 `entry: false`，至少一个 `calls` 引用者。
- **O3 入口大降。** 模块入口比基线少至少 50%。
- **O4 按同一组决定，未使用大降。** 用同一份决定文件跑 `report`（按框架约定，`app/root.tsx` 与 `app/routes/` 下各文件的顶层函数判为 `entry`，其它不决定），模块未使用节点比基线少至少 50%，`Button` 不是未使用。
- **O5 精度。** 独立审计脚本（只读文本，正则解析 import 与导出，自写说明符解析）核对模块里每条带 `token` 的 `calls` 边：证据行含 `<token`；调用者行范围含证据行；目标是沿 import 与转发链得到的声明。先往图里注入一条改了目标的边，确认审计报出它。每种 `jsx-*` gap 抽样读源码核对去向。
- **O6 召回与守恒。** `coverage.jsxElements` 守恒；模块里非内建调用点数与独立的文本计数（开标签与自闭合标签里大写开头或带点的标签）一致，差异逐个解释。
- **O7 其它语言不变。** 两端都不在 TS/JS 文件里的节点与边，与基线逐条相同。

## 验收记录

2026-10-19，hadoop `2014707f8c31` 的 scratchpad 克隆，运行的代码与本分支提交 `e4a2dae7` 相同，其后的提交只改测试、夹具与文档。先 rebuild core，基线产物另存后再跑：`lazy-analyze` 239 s，`unused-code candidates` 31 s。产物、审计脚本与中间结果都留在 scratchpad，不提交。

- **O1 达标。** 模块候选 510（TS 504、JS 6），与基线相同；全仓候选 103,703 不变。
- **O2 达标。** `button.tsx` 的 `Button` 为 `entry: false`，37 个 `calls` 引用者（基线 0）。
- **O3 达标。** 模块入口 335 → 163（−51.3%）：TS 334 → 162，JS 1 → 1。全仓的 TS 函数节点都在本模块。
- **O4 未达标（按写定阈值）。** 同一份决定文件（`app/root.tsx` 与 `app/routes/` 下的 12 个顶层函数判为 `entry`）跑 `report`：模块未使用 497 → 257（−48.3%，阈值 50%）；`Button` 不再是未使用。逐个核对剩下的 257：
  - 48 个在测试文件里：决定文件没有测试入口，测试里的元素又落进 `jsx-caller-unresolved`；
  - 147 个不是组件（工具函数、store、配置、hook），经普通调用或值引用使用，本变更不改（Non-Goals）；
  - 50 个组件没有任何 JSX 元素渲染它：48 个在自身文件以外的非测试代码里不出现（如没用到的 `ContextMenu*`、`Sidebar*` 部件），`Toggle` 只出现在英文文案里，`CustomFlowEdge` 作为 React Flow 的 `edgeTypes` 值传入；
  - 11 个只在 `QueueCardNode` 的子树里被渲染，而 `QueueCardNode` 作为 React Flow 的 `nodeTypes` 值传入（值传递，Non-Goals）；
  - 1 个只在测试里被渲染。

  剩下的未使用节点没有一个是因为 JSX 元素解析错或落进 gap 而留下的。50% 的阈值是在没拆分基线未使用集构成时写定的，偏高；按写定阈值记为未达标，不改阈值。
- **O5 达标。** 独立审计脚本（Python，只读文本；正则抽取 import、导出与顶层声明，自写说明符解析，含 tsconfig 的 `~/` 别名；与抽取器、解析器不共用代码）核对模块里全部 539 条带 `token` 的 `calls` 边。三项都核对：证据行含 `<token`；调用者行范围含证据行；目标等于审计沿 import 与转发链得到的声明。结果 0 处不符。
  - 仪器校验：往内存里的图注入一条改了目标的边、一条错一行的证据，审计报出 2/2。
  - 首轮审计还报出 1 处，查实是审计自己的正则漏了跨行类型注解的 `const DiffLine: React.FC<{…}> = (…) =>`；修正审计后为 0。
  - 各 gap 种类抽样读源码，去向都符合原因文本：
    - `jsx-caller-unresolved` 643：642 个在测试文件的 `it(...)` 回调里，1 个在 `forwardRef` 回调里（`field.tsx` 的 `<Label>`）。
    - `jsx-target-unresolved` 132：导入解析到 `forwardRef` 值（`Field*`、`Kbd`、`Drawer*`）或别名值（`const Form = FormProvider`）。
    - `jsx-unbound` 17：局部变量 `Comp`（`asChild ? Slot : 'button'`），同文件顶层的 `forwardRef` 值（`DrawerOverlay`）与 context 值。
    - `jsx-external` 337：图标库与 Radix 原语等包。
    - `jsx-ambiguous` 0。
- **O6 达标。** `coverage.jsxElements` = `{files 145, intrinsic 914, sites 2031, edge 902, external 337, unbound 17, targetUnresolved 132, ambiguous 0, callerUnresolved 643}`，守恒成立。
  - 独立文本计数：文件 145 = 145，内建 914 = 914，非内建 2033 对 2031。多出的 2 个在错误消息字符串里（`<Field>`、`<FormField>`），不是元素。
  - 审计对 2031 个调用点逐个独立分类，五个去向的计数与 coverage 逐项相等。
  - 902 个成边调用点合成 539 个调用者 → 目标对，与图里带 `token` 的 539 条边一一对应。
- **O7 达标。** 两端都不在 TS/JS 文件里的节点（153,282）、边（778,316），以及非 TS/JS 范围的 gap（196 条），都与基线逐条相同。比较方法是按行内容哈希的多重集；仪器校验时在内存里改一条非 TS/JS 边的权重，比较报出 1/1。全图差异都在 TS/JS：
  - 边 +600 = 539 条 JSX `calls` + 60 条桶文件 `imports`（D7）+ 1 条 `exports`（D8）；没有删除。
  - 新增四种 `jsx-*` gap；`exports-unresolved`（javascript）6 → 9，是新记录的 3 个 `export default X;` 指向值而不是函数（如 Ember 应用的 `export default App;`），可见。
  - `coverage.byLanguage` 只有 typescript、javascript 两行变化：import 条目 TS +64（`export … from` 同时记为 import），export 条目 TS +1、JS +3，12 个只有转发的 TS 桶文件从 zero-symbol 变成 parsed。
