提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。oracle O1–O7 见 design。

## 1. Core：规则与通用抽取器

- [x] 1.1 红测试：`packages/core/src/plugins/__tests__/route-facts.test.ts`（O1 三组夹具）；`FrameworkConfigSchema` 拒收未知键与缺字段的 `routes`；抽取代码里没有框架名（扫 `route-facts.ts` 的字符串字面量与三份配置的 id）。
- [x] 1.2 `languages/types.ts` 加 `routes` schema；`frameworks/{gin,express,react}.ts` 加规则（D2）。
- [x] 1.3 `plugins/route-facts.ts`（D3、D4）；`tree-sitter-plugin.ts` 的 `analyzeFile` 与 `analyzeFileFull` 调用它；`types.ts` 的 `StructuralAnalysis` 加可选 `routes`。
  - **验证：** 1.1 绿；`pnpm --filter @excavator/core test`；`pnpm run typecheck`。

## 2. 事实构建：解析、记录流、覆盖、版本

- [x] 2.1 红测试：`extract-structure-result` 校验并写出 `routes`（坏形状拒收）；import map 的 `require()`/`import()` 进 `resolvedSources`、`import()` 不加边、Go 的 `resolvedPackages`；`tests/lazy/entry-point-resolution.test.mjs`（O2）；知识图存储往返 `entryPoints` 流；`factsDigest` 随记录流变化；O3。
- [x] 2.2 `extract-structure-result.mjs`、`extract-import-map.mjs`（D6）。
- [x] 2.3 `entry-point-resolution.mjs`（D5、D7）；`build-fact-graph.mjs` 接入、缺口原因、守恒；`knowledge-graph-store.mjs` 加流；`validate-graph.mjs` 认这个键；`lazy-analyze.mjs` 的 `PIPELINE_VERSION` 与注释（D8）。
  - **验证：** 2.1 绿；受影响的既有测试（`git grep` 出读这些模块的测试）绿；`pnpm -r build` 后 core dist 是新的。

## 3. `/excavator-domain`

- [x] 3.1 红测试：抽取脚本从知识图读入口点、不再用 HTTP 正则产生入口点、`unrecognisedFiles`、`unavailable`；分区清单与区上下文带未识别文件；合并核对模型入口点（O6）；SKILL 与分析器说明的契约测试。
- [x] 3.2 改 `extract-domain-context.py`、`split-domain-areas.mjs`、`merge-domain-areas.mjs`、`SKILL.md`、`agents/excavator-domain-analyzer.md`（D9、D10）。
  - **验证：** 3.1 绿；`node scripts/check-refs.mjs`；`tests/domain/` 绿。

## 4. `/excavator-unused-code`

- [x] 4.1 红测试（O7）。
- [x] 4.2 改 `unused-code.mjs` 与 `skills/excavator-unused-code/SKILL.md`（D11）。
  - **验证：** 4.1 绿；既有 unused-code 测试绿。

## 5. 实测与收尾

- [x] 5.1 O3、O4、O5：在 `go-multirepo` 的副本（`~/Documents` 下，原件不动）上用重建过的 core dist 跑 Lazy；记录语义计划、节点对比、入口点按框架/桶/模块的前后计数、分层抽查结果与花费。
### 5.1 实测记录（`go-multirepo` 副本，2026-11-23，花费 $0，没有模型运行）

副本在 `~/Documents` 下，原件不动。三份副本：
- 基线：原 `.excavator` 的拷贝，`lazy-fact-graph/16`。
- 对照：main 的代码跑 Lazy。
- 之后：本分支（含 4 号 commit）跑 Lazy，不加 `--full`，用重建过的 core dist。

**O3**
- 跑之前清单是 /16，源码不变。
- 跑之后清单与图都是 `lazy-fact-graph/17`，带 `entryPoints` 流与 `coverage.entryPoints`。

**O4**
- `select-stale-semantics` 前后都是请求 10483、复用 10483、生成 0、不可用 0。
- 对照 vs 之后：
  - 节点 10483 = 10483，整条 JSON 比较 0 处不同；
  - 边 40183 = 40183，0 处不同。
- 缺口只多了两类新原因：`entry-point-prefix-unresolved|gin` 4 条、`entry-point-handler-unresolved|react` 3 条。

**O5，F1 流**：877 条记录，其中入口点 845 条、挂载 32 条。

| 框架 | 文件 | 入口点 | resolved | prefix-unresolved | 处理者 node / module / inline / external / unresolved / none |
|---|---|---|---|---|---|
| gin | 10 | 487 | 483 | 4 | 482 / 0 / 2 / 3 / 0 / 0 |
| express | 16 | 90 | 90 | 0 | 0 / 0 / 90 / 0 / 0 / 0 |
| react | 24 | 268 | 268 | 0 | 142 / 34 / 0 / 66 / 3 / 23 |

挂载：
- express 15 条 resolved（含内联 `require()` 路由器）、12 条 ignored（`app.use(cors())` 之类，都带行号）；
- react 5 条 resolved。

**O5，召回**：grep 注册形状的行，与记录行对照。
- Gin：grep 到 501 行，16 行没有记录。
  - 10 行是注释，3 行是 `zap.Any` 日志调用。
  - 3 行是接收者来自结构体字段读取的 `/health` 注册，规则按设计不认。domain 把它们标为「脚本未识别」交给模型。
- Express：grep 到 91 行，1 行没有记录，是注释。
- React：`<Route` 226 行，全部有记录。对象键 `path:` 73 处，38 处没有记录，都是正确排除：32 处在菜单配置里，6 处在标签页数组里。

**O5，精度**：按框架分层抽查 resolved 入口点 20 条（gin 7、express 6、react 7），逐条对源码。路径、方法、前缀（Gin 分组链、Express `require(...)(passport)` 加 `app.use`、React 懒加载模块经 `/x/*` 挂载的嵌套 `<Route>`）与处理者声明全部正确，编造 0/20。

**O5，非 resolved 情况逐条解释**
- Gin 4 条 prefix-unresolved：注册在 `*gin.RouterGroup` 参数上，按设计不解析。
- Gin 3 条 external：`swaggerFiles.Handler`。
- Gin 2 条 inline：来自 `_test.go`，domain 丢弃测试文件。
- React 3 条 unresolved：2 条是 `memo(...)` 包装，没有函数节点；1 条是 JSX 条件表达式。
- React external：`Navigate` 65 条、`Outlet` 1 条。

**O5，domain 前后**（按 domain 的模块划分，共 293 个模块）
- 之前（旧 HTTP 正则）：122 个入口点，分布在 8 个模块。
- 之后（`entryPointSource=facts`）：
  - 脚本 843 条，正则 17 条（事件监听 16、导出的处理者 1），测试文件上的脚本入口点 2 条被丢弃，共 860 条；
  - 82 个模块有入口点，3 个模块有「脚本未识别」文件；
  - 两次运行 `extract-domain-context.py` 输出逐字节相同。

| 仓库 | 之前 | 脚本 | 正则 | 未识别文件 | 模块数 |
|---|---|---|---|---|---|
| Go 认证服务 | 0 | 14 | 0 | 1 | 3 |
| Go 主服务 | 0 | 381 | 0 | 1 | 24 |
| Node 服务 | 103 | 90 | 14 | 0 | 5 |
| React 前端 | 3 | 268 | 3 | 0 | 41 |
| Go 审核服务 | 0 | 90 | 0 | 1 | 12 |

- Node 服务根模块之前的 16 条，是 `app.js` 里 `app.use('/x', ...)` 的正则命中。现在它们是挂载记录，给各路由加前缀，不再算入口点，没有路由丢失。
- 路由模块从 90 变成脚本 89 加正则 2：多出旧正则漏掉的 `GET /holidays`，两个流事件 `.on()` 仍是正则入口点。

**unused-code 前后**：同一份事实，在对照副本（没有流）与之后的副本上各跑一次 `unused-code.mjs candidates`。

| | 函数节点 | 可达 | 根（entryPoints） | 候选 |
|---|---|---|---|---|
| 对照 | 6527 | 0 | 0 | 6527 |
| 之后 | 6527 | 1567 | 585 | 4960 |

- 按语言的可达数：Go 527、TypeScript 1040、JavaScript 0。
- JavaScript 为 0，因为 Express 处理者全是内联，没有函数节点。

**O6、O7**：夹具测试绿（`tests/domain/`、`tests/lazy/unused-code-entry-point-roots.test.mjs`）。

- [x] 5.2 把实测写进本 tasks 的 5.1，`openspec validate --all --strict`。
