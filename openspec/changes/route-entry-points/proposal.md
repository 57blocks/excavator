## Why

`#159`、`#160` 之后，域规划逐字节一致，模块到域的归属稳定（支撑域流程约从 25% 降到 4–6%）。剩下的不稳定来自流程集合本身，以及依赖分析器自由裁量的覆盖桶。根源是入口点：

- `/excavator-domain` 用自己的正则清单（`extract-domain-context.py` 的 `ENTRY_POINT_PATTERNS`）找入口点。清单里没有 Gin、没有 React Router，也不认 Express 的挂载前缀（`app.use('/x', router)`）。
- 在真实混合项目 `go-multirepo`（Go Gin + Node Express + React，293 个模块）上，它在 293 个模块里只有 8 个模块找到入口点，共 122 个。后果有两个：
  - `merge-domain-areas.mjs` 的静默为零守卫只看有入口点的模块。其余模块被分析器默默忽略时落进 `no-candidates`：同一输入的两次运行，有 43 个模块在 `no-candidates` 与 `declared-skip` 之间翻转。
  - 流程没有稳定的锚：两次运行的流程 id 只有 21% 相同，首个步骤所在文件只有 43% 相同。
- `/excavator-unused-code` 在同一项目上报告 Gin、Express、React 的路由根为 0。原因相同：它的根只取 `routes` 边的目标，而 `routes` 边今天只有 JAX-RS 目录生成。

用户的要求不变：每次运行数据一致；产物不手改，修在管线里；覆盖缺口可见即可，编造零容忍。

## What Changes

- **入口点是 F1 事实。** Core 加一个通用的路由抽取器。它在 tree-sitter 语法树上执行框架配置里声明的匹配规则，对每个注册写出方法、路径、处理者、文件与行。不加新的解析器，不加新的 skill，抽取不调用模型。
- **规则是数据，写在已有的框架注册表里。** `FrameworkConfig` 加可选字段 `routes`。本步只给 `gin`、`express`、`react`（React Router）三份规则，其它框架不加。每份规则都有夹具测试：
  - Gin：`r.GET/POST/...`、`Group(prefix)` 嵌套、处理方法；
  - Express：`router.get(...)`、`app.use('/x', router)` 前缀、跨文件的 `module.exports = router`（含返回 router 的工厂函数）；
  - React Router：`<Route path element>` 与 `createBrowserRouter` 的路由对象。
- **跨文件挂载在事实构建里解析。** 新模块 `skills/excavator/entry-point-resolution.mjs` 用 import map 与已有的模块绑定解析器，把挂载前缀接到被挂载的路由上，把处理者解析到已有的函数节点。import map 为此新增两样东西：TS/JS 的 `require()` 与 `import()` 字面量进 `resolvedSources`；Go 的导入路径进新字段 `resolvedPackages`。
- **每个注册落一个可见桶，没有静默丢弃。**
  - 路径能拼全：`resolved`；
  - 注册找到了但路径拼不出（拼接、变量、循环、配置驱动）：`path-unresolved`，带文件与行；
  - 自身路径是字面量，但外层前缀来自没有解析到的挂载：`prefix-unresolved`；
  - 处理者分 `node`、`module`、`inline`、`external`、`unresolved`、`ambiguous`、`none` 计数。
- **入口点存成知识图的新记录流 `entryPoints`，不是新节点。** 已有节点的 id 与内容一字不变，F2 语义缓存不失效（理由见 design D1）。`coverage.entryPoints` 计数、守恒，三个新缺口种类。
- **F1 能察觉抽取器升级。** `PIPELINE_VERSION` 升到 `lazy-fact-graph/17`。已有项目即使文件内容没变，下一次 `/excavator`（不带 `--full`）也会重新投影，并带上新字段。
- **一个共用来源。**
  - `/excavator-domain`：HTTP 入口点改为从知识图的 `entryPoints` 读，不再用自己的 HTTP 正则。原来的 HTTP 正则降为「像处理者的代码」检测：命中却没有任何 F1 记录覆盖的文件标为「脚本未识别」。没有知识图时，先跑一次确定性的 Lazy 构建。CLI、事件、定时、导出处理者四类非 HTTP 正则不变。
  - 静默为零守卫随之覆盖所有有脚本入口点的模块，也覆盖有「脚本未识别」文件的模块。
  - `/excavator-unused-code`：根加上 `entryPoints` 里解析到函数节点的处理者，单独计数。
- **模型补充在已有的域 skill 里。** 「脚本未识别」的文件交给该区的域分析器。分析器找到的入口点标 `source: "model"`，带一句引文；合并脚本按源码核对引文，核对不过的拒收并计数。覆盖报告把脚本入口点与模型入口点分开计数。不加新 skill。

提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose route-entry-points`
2. `feat(core): extract route registrations from framework rules`
3. `feat(excavator): resolve route entry points into the fact graph`
4. `feat(excavator-domain): read entry points from the fact graph and check model-found ones`
5. `feat(excavator-unused-code): root route entry points`
6. `docs(openspec): record the measured entry points of route-entry-points`

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `fact-graph`：新增「框架规则路由入口点」「入口点记录流与覆盖」两条要求。
- `domain-area-coverage`：新增「入口点来自事实层」「脚本未识别文件的模型补充」两条要求。
- `unused-code`：「未使用代码的定义」的根加上入口点处理者。

## Impact

- `packages/core/src/languages/types.ts`、`frameworks/{gin,express,react}.ts`：`routes` 规则 schema 与三份规则。
- `packages/core/src/plugins/route-facts.ts`（新）、`tree-sitter-plugin.ts`、`types.ts`：通用抽取器，结构结果加可选 `routes`。
- `skills/excavator/extract-structure-result.mjs`：校验并写出 `routes`。
- `skills/excavator/extract-import-map.mjs`：`resolvedSources` 加 `require()`/`import()` 字面量；新增 `resolvedPackages`。
- `skills/excavator/entry-point-resolution.mjs`（新）、`build-fact-graph.mjs`、`lazy-analyze.mjs`、`knowledge-graph-store.mjs`、`validate-graph.mjs`：解析、记录流、覆盖、缺口、版本。
- `skills/excavator-domain/extract-domain-context.py`、`split-domain-areas.mjs`、`merge-domain-areas.mjs`、`SKILL.md`、`agents/excavator-domain-analyzer.md`。
- `skills/excavator/unused-code.mjs`、`skills/excavator-unused-code/SKILL.md`。
- 不改：已有节点与边的 id 和内容、JAX-RS 路由目录与 `endpoint` 节点、语义缓存格式、F2 选择规则。
