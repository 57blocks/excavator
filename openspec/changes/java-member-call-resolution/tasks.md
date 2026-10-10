提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): propose java-member-call-resolution`：proposal、design、规格增量、tasks。
1. `feat(java): extract type facts and abstract methods`：任务 1.1–1.3。
2. `feat(java): describe call receivers`：任务 2.1–2.2。
3. `feat(facts): resolve Java member calls by declared type`：任务 3.1–3.4。
4. `feat(facts): Java type hierarchy edges`：任务 4.1–4.2。
5. `test: refreeze Java fact digests`：任务 5.1（若无固定摘要变化则省略）。
6. `docs(openspec): record java-member-call-resolution acceptance and archive`：任务 6.x、7.1。

## 1. 类型事实

- [x] 1.1 `java-extractor.ts` 为每个顶层类型输出 `kind`（class / interface / enum / record）、`qualifiedName`（包名 + 类名）、`supertypes`（`extends` 与 `implements` 的类型文本）、`fieldTypes`（字段名到声明类型）与 `annotations`（类注解名）。验证：抽取器单测覆盖类、接口（继承多个接口）、枚举（实现接口）、记录、带注解的类。
- [x] 1.2 接口方法（无方法体的、`default`、`static`）与抽象方法进入 `functions`，带 `owner`、参数类型、返回类型，无方法体的标 `abstract: true`。验证：抽取器单测；接口方法的节点 ID 为 `Owner#name(types)`。
- [x] 1.3 `types.ts` 加上述可选字段；`extract-structure-result.mjs` 校验并透传 `kind`、`qualifiedName`、`supertypes`、`fieldTypes`、`annotations`、`returnType`、`abstract`。验证：结构结果单测；对只含非 Java 文件的夹具，结构结果与改前相同。

## 2. 调用点的接收者

- [x] 2.1 `extractCallGraph` 按作用域栈绑定局部名字（参数、局部变量、for-each、catch、try-with-resources、`instanceof` 模式变量），为每个调用点输出 D2 的 `receiver`、`argCount`、`enclosingType`；`new X(...)` 也带 `argCount`。验证：抽取器单测覆盖 D2 的每种形态、遮蔽、lambda 参数、匿名类与嵌套类型内的调用（`enclosingType: null`）。
- [x] 2.2 `extract-structure-result.mjs` 校验并透传 `receiver`、`argCount`、`enclosingType`。验证：结构结果单测；非 Java 调用点与改前相同。

## 3. 成员调用解析

- [x] 3.1 新增纯函数模块 `skills/excavator/java-call-resolution.mjs`：按 D3 建类型表、解析类型名；按 D4 解析接收者类型与方法；按 D6、D9 分类。验证：模块单测覆盖规格「Java 成员调用按接收者的声明类型解析」的每个场景。
- [x] 3.2 `build-fact-graph.mjs` 对 `language === 'java'` 的行改用该模块（D7、D8、D11），新增缺口类型 `calls-external`、`calls-generated` 及其说明；其它语言走原路径。验证：事实图单测；用已知答案的小 Java 样例逐条核对边与桶。
- [x] 3.3 守恒：测试断言 Java 调用点总数 = 成边的调用点数 + 五个桶的计数。验证：守恒测试，并制造一个故意漏桶的变体，确认测试能变红。
- [x] 3.4 非 Java 不变：已有非 Java 夹具的 factsDigest 不变。验证：现有固定摘要测试中非 Java 部分保持绿。

## 4. 类型层次边

- [x] 4.1 事实图按 D10 生成类到类的 `inherits` / `implements` 边，以及方法到方法的 `implements` 边，带声明行证据；仓库外父类型不成边。验证：事实图单测覆盖规格「Java 类型层次边」的三个场景。
- [x] 4.2 `retrieve.mjs` 的确定性边类型加入 `inherits`、`implements`。验证：遍历单测——从调用接口方法的函数出发，经 `calls` 与 `implements` 走到实现方法。

## 5. 固定摘要

- [ ] 5.1 Java 夹具的固定摘要用生成器整块重冻，并在 commit 说明里列出变化的摘要及原因。验证：全量测试通过。

## 6. 验收

- [ ] 6.1 全量门：`pnpm -r build`、`pnpm test`、`pnpm typecheck`、Python 测试、`check-refs`、`openspec validate --all --strict`。`pnpm lint` 不列入：main 上缺 ESLint 9 所需的配置文件，本来就跑不了，已另立待办。
- [ ] 6.2 Fineract 与 hadoop 前后对比：调用点去向分布与守恒、解析率、贷款范围入口可达文件数。
- [ ] 6.3 改前的每条 Java `calls` 边在改后的去向，逐条解释。
- [ ] 6.4 独立代理抽查 Fineract 50 条新边（至少 20 条的目标层次含仓库外父类型），0 错；报告这类边的总数。
- [ ] 6.5 非 Java 不变：wcp-auth、wcp-service-v2、cebreo/unmc 的 factsDigest 前后相同；cebreo/uneeg-managementportal 的变化逐项解释。
- [ ] 6.6 hadoop 的 Lazy 必须在默认堆（不设 `NODE_OPTIONS`）下成功；用时、最大常驻内存、图谱大小与序列化余量和 line-store 合入后的基线（118.6 秒、3.22 GB）对比，用时增幅不超过 30%。单字符串上限已由 knowledge-graph-line-store 消除；若堆溢出，先完成降低 Lazy 峰值堆占用的前置变更（见 design「Risks」），不靠调大堆过关。
- [ ] 6.7 对改后的 Fineract 运行 `deploy/mcp-smoke.mjs`，7 个工具全部通过。

## 7. 归档

- [ ] 7.1 规格增量同步到 `openspec/specs/fact-graph/spec.md`，变更移入 `openspec/changes/archive/`，`openspec validate --all --strict` 通过。
