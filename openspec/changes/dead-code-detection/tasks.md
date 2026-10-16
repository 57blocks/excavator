提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入；切片 A 的每个 commit 单独可测、可合入，切片 B 依赖切片 A；产物与 CLI 放在引擎的最后一个 commit，之前的任何 commit 都不会向用户发出判定；全程 build-free）：

0. `docs(openspec): propose dead-code-detection`：proposal、design、规格增量、tasks。
1. `feat(java): extract method visibility, modifiers, annotations and class literals`：任务 1.1–1.3。
2. `feat(java): record method references as call sites`：任务 2.1–2.3。
3. `feat(facts): complete Java hierarchy edges and record uncertain overrides`：任务 3.1–3.3。
4. `test: refreeze Java fact digests`：任务 3.4（若无固定摘要变化则省略）。
4a. `fix(java): normalize wrapped qualified names and fail closed on malformed type keys`：任务 3.5（切片 A 验收发现 D2）。
4b. `feat(java): record call sites outside method bodies`：任务 3.6（切片 A 验收发现 D1）。
4c. `docs(openspec): record slice A acceptance`：验收记录与基线数字更正。
5. `feat(liveness): declaration file and language rule catalog`：任务 4.1–4.3。
6. `feat(liveness): language-agnostic engine, resolved reachability and verdict order`：任务 5.1–5.2。
7. `feat(liveness): may-reference graph, evidence and stance conditions, suspect propagation`：任务 5.3–5.5。
8. `feat(liveness): Java adapter`：任务 5.6。
9. `feat(liveness): text-occurrence veto`：任务 5.7。
10. `feat(liveness): dead-code product, CLI and tripwire fixtures`：任务 5.8–5.11。
11. `feat(mcp): read-only dead_code tool`：任务 6.1–6.2。
12. `feat(skill): excavator-dead-code`：任务 7.1。
13. `docs(openspec): record dead-code-detection acceptance and archive`：任务 8.x、9.1。

切片 A = 提交 1–4c（引用覆盖补齐，本身就改善图谱与遍历）；切片 B = 提交 5–11（判定与工具面）；切片 C = 提交 12。切片 B 的第 10 个 commit 之前不产出任何判定产物。

## 1. 方法声明事实与类字面量（切片 A）

- [x] 1.1 `java-extractor.ts` 为每个方法与构造器条目输出 `visibility`（`public` / `protected` / `package` / `private`；接口成员默认 `public`）、`modifiers`（`static`、`final`、`native`、`default`、`synchronized`、`abstract`，源码顺序）与 `annotations`（方法注解名，复用类注解的提取，去掉包前缀）；`types.ts` 加对应可选字段。验证：抽取器单测覆盖四种可见性、接口的 `default` / `static` 方法、带多个注解的方法、构造器；Java 节点 ID 与改前相同（身份测试不变）。
- [x] 1.2 `java-extractor.ts` 为每个文件输出 `classLiterals`：每个 `X.class` 的类型文本、行号与上下文（`annotation`：位于注解实参内，含嵌套的数组与注解实参；`code`：其它位置）；`types.ts` 加字段。验证：抽取器单测覆盖 `@Mapper(uses = Helper.class)`、`uses = {A.class, B.class}`、方法注解实参、方法体与字段初始化里的 `Foo.class`。
- [x] 1.3 `extract-structure-result.mjs` 校验并透传 `visibility`、`modifiers`、`annotations`、`classLiterals`；`visibility` 与 `context` 的取值是封闭集合，形状不对整体判失败。验证：结构结果单测；只含非 Java 文件的夹具结构结果逐字节不变。

## 2. 方法引用作为调用点（切片 A）

- [x] 2.1 `extractCallGraph` 把 `method_reference` 记为调用点：`X::m` / `expr::m` / `this::m` / `super::m` 的 `callee` 为 `m`，接收者按 D2（java-member-call-resolution）描述；`X::new` 记为对 `X` 的构造调用；`argCount: null`；数组类型的构造引用接收者带数组类型文本。验证：抽取器单测覆盖每种形态与 lambda 内的方法引用；`extract-structure-result.mjs` 接受 `argCount: null`。
- [x] 2.2 `java-call-resolution.mjs`：`argCount: null` 视为适用任意参数个数；恰好一个声明成边，多个记 `calls-ambiguous`；数组类型的构造引用记 `calls-external`。验证：模块单测覆盖规格「Java 方法引用作为调用点」三个场景；守恒测试计入方法引用调用点。
- [x] 2.3 事实图单测：含 `PlatformCache::isEhcacheEnabled` 形态的小 Java 样例产生指向目标的 `calls` 边，证据行正确。验证：单测通过；非 Java 夹具 factsDigest 不变。

## 3. 层次边补齐（切片 A）

- [x] 3.1 `java-call-resolution.mjs` 的 `hierarchyEdges()`：(a) 具体方法（含接口 `default`）到最近仓库内具体祖先方法（非 `private` 非 `static`，含 `default`）的 `overrides` 配对；(b) 继承来的实现——对每个具体类型 C，祖先的每个抽象方法 A，C 没有自己声明同名同参数个数方法时，取 C 父类链里最近的同名同参数个数具体声明 M（类优先于接口 `default`），配对 `M → A`，证据为 C 的该父类型声明行；(c) 接口不再整体跳过，`default` 方法实现父接口抽象方法也配对；(d) 任一方擦除签名为 null 的同名同参数个数配对进入 `uncertainPairs`，不再 `break` 丢弃；(e) 继承来的覆写——对每个类、枚举、record 类型 C，接口祖先的每个 `default` 方法 A，C 没有自己声明时取父类链里最近的同名同参数个数具体类方法 M，配对 `M → A`（`overrides`），证据为 C 引入 A 的父类型声明行，抽象重声明阻断。验证：模块单测覆盖规格「Java 类型层次边」与「Java 具体方法覆写边」的每个场景，含类型变量、嵌套类型参数、按需导入参数三种不确定配对。
- [x] 3.2 `build-fact-graph.mjs` 投影 `overrides` 边与继承实现的 `implements` 边，`uncertainPairs` 记为 `override-uncertain` 缺口（scope `java`，样例为两个声明）；`retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 加 `overrides`。验证：事实图单测；遍历单测从调用 `Base#fallback` 的方法走到 `Sub#fallback`，从调用 `I#m` 的方法走到继承来的 `Base#m`；制造一个把不确定配对静默丢弃的变体，缺口计数测试必须变红。
- [x] 3.3 D13：`resolveFileCalls(row, { report: true })` 对每个调用点补充 `receiverType`、`candidates`、`target`（仅 `calls-caller-unresolved`）；`hierarchyEdges()` 返回 `uncertainPairs`；非报告模式逐字节不变。验证：模块单测；现有事实图测试全部不变。
- [x] 3.4 Java 夹具的固定摘要用生成器整块重冻，commit 说明列出变化的摘要与原因；非 Java 夹具不得变化。验证：全量测试通过。（实施结果：没有任何固定摘要变化，提交 4 按约定省略；`NON_JAVA_ROWS_SHA256` 不变。）

## 3A. 切片 A 验收发现的修复（切片 A）

- [x] 3.5 D2：跨行书写的限定名（`import a.b\n    .C;`、限定名里的注释）在结构结果里保留了空白，`erasedTypeKey()` 把它当作确定的键，`compareErased()` 判为「不同」，配对既不成边也不入缺口（静默丢失）。抽取器从标识符记号重建点分名（import、package、注解名），类型文本去掉注释与 `.` 两侧的空白；解析器对不是合法点分名的键、包名与 import 一律判未知（配对进入 `override-uncertain`，不判不同）。参数类型里含跨行限定名的函数节点 ID 随之规范化（只影响 ID 原本含换行的节点；只差空白的类型不是不同类型，不会合并重载）。验证：抽取器与事实单测（修前红）；hadoop 只读重抽 199 个含跨行名的文件，层次边 +5 type / +19 implements / +6 overrides、无丢失；fineract 所有 Java 行逐字节不变。
- [x] 3.6 D1：方法体之外（字段初始化、初始化块、枚举常量实参、record 紧凑构造器）的调用点——方法引用、方法调用与对象创建——完全不记录，既不成边也不入桶。改为记录，调用者记为 `<clinit>`（静态上下文）或 `<init>`（实例上下文），归入 `calls-caller-unresolved`，报告模式给出已解析目标。验证：抽取器单测覆盖每种上下文；守恒；Fineract / hadoop 只读普查里方法引用记录数等于 tree-sitter 总数。

切片 A 验收记录（9381b2da 对基线 ca2eba01，独立 Opus 验收代理，全部 build-free、语料只读，报告在本地 `excavator-test-runs/dead-code-slice-a/summary.md`，不进仓库）：9 项检查全部通过；源码审读 128 条（方法引用边 30、`overrides` 边 30、新 `implements` 边 19、`override-uncertain` 配对 30、歧义方法引用 10 等）0 条编造；go-multirepo-auth / go-multirepo-service-v2 / maui-app 的 factsDigest 与基线相同，kotlin-portal 只有 Java 变化；Fineract / hadoop 基线边 0 丢失；`PlatformCache::isEhcacheEnabled` 成边，`COBBusinessStep` 的 21 个实现全部记 `override-uncertain`；hadoop Lazy 用时 +8.2% / +8.9%；MCP 冒烟 7 个工具通过。验收发现 D1、D2 两处静默丢失，由 3.5、3.6 修复；修复后的 Fineract / hadoop 只读重抽：方法引用、方法调用、对象创建的记录数等于 tree-sitter 总数，原有调用点逐字节不变，守恒成立。设计里的「126 个具体覆写」实为 97 个（其余 29 个是 static 隐藏、private 与重载），已更正。

## 4. 活性声明与语言规则数据（切片 B）

- [ ] 4.1 新增 `skills/excavator/liveness-declaration.mjs`：读取并严格校验项目根目录的 `.excavator-liveness.json`（`version`、`publicApi[]{paths,stance}`、`testScope[]`、`annotations.method` / `annotations.class`、`beanAccessors`、`roots[]`），未知键或未知取值以具名错误失败；缺文件返回「全部未声明」；计算声明摘要。验证：单测覆盖合法、缺失、未知键、非法分类值。
- [ ] 4.2 新增规则数据 `skills/excavator/liveness-catalog/java.json`（`language`、`coverage: "complete"`、`identifierPattern`、`builtinRoots`、`annotations[]{name,target,class,source}`、`conventions`）与加载器（校验形状、每条注解都有出处、计算目录摘要）；首版只收 D3 列出的条目。验证：单测校验形状；`inert` 条目只允许 D3 写明的两类（只生成成员、只引起实例化）。
- [ ] 4.3 路径 glob 匹配与首匹配语义的单测（`publicApi` 顺序、`testScope`）。验证：单测通过。

## 5. 判定引擎（切片 B）

- [ ] 5.1 新增 `skills/excavator/dead-code.mjs` 的引用事实模型（D7：节点事实、调用点事实、可能覆写配对、类字面量目标）与语言表 `skills/excavator/liveness/index.mjs`（登记适配器、覆盖声明、规则数据；未登记或 `none` 的语言 ⇒ `language-not-covered`）；引擎对不认识的类型种类 fail-closed。验证：以合成事实为输入的单测；一个只含合成第二语言事实的夹具证明引擎不含语言分支。
- [ ] 5.2 解析边可达性与判定顺序：生产根 / 测试根、`calls`、分派（只从被调用而活的方法出发）、声明依赖；`live` / `test-only` 记录根与前驱。验证：单测覆盖规格「活性判定的定义」里 `live` / `test-only` 的场景（覆写来自被覆写、继承实现经接口调用、实现活则接口活、仅声明依赖不向兄弟分派、仅测试）。
- [ ] 5.3 可能引用图（D5）：四种调用点事实的候选构造、懒缓存、可见性收窄（`private` 同文件、包私有同包）、可能覆写配对双向计入。验证：单测覆盖规格「可能引用图」的每个场景；一个同名不同包的夹具证明包私有收窄。
- [ ] 5.4 发出条件（D4）：证据类——`language-not-covered`、`constructor-out-of-scope`、`public-api-external`、`may-override-external`（含子类型、嵌套与其它语言类型、`@Override` 外部契约根、`Object` / `Enum` / `Record` 例外）、`annotation-unclassified` / `annotation-reflective`、`annotation-class-literal`、`annotation-element`、`bean-accessor`、`identity-collision`；立场类——`public-api-undeclared`；内建根。验证：单测覆盖规格「`dead` 的发出条件与残余假设」与「根与活性声明」的每个场景（文本否决场景除外，见 5.7）。
- [ ] 5.5 分层传播与 `suspect`：先从根、`undetermined`、`live` / `test-only` 传播 `undetermined`，再从 `suspect` 传播 `suspect`（了结声明沿前驱继承），其余 `dead`；簇与「直接无引用」标志。验证：单测覆盖 A/B 对、只被 suspect 公开方法引用的私有方法、证据压过立场、孤岛环、从 suspect 经可能引用可达；制造一个漏桶变体，五桶守恒断言必须变红。
- [ ] 5.6 Java 适配器 `skills/excavator/liveness/java.mjs`：把结构结果、事实图与解析器报告模式（D13）投影为引用事实（可见性、可分派性、作用域键、注解、层次是否触及仓库外含子类型、内建根、`bean-accessor` 约定、调用点事实、`uncertainPairs`、类字面量目标）；登记到语言表，覆盖声明 `complete`。验证：对小 Java 夹具的适配器单测逐字段核对；以适配器输出跑引擎得到的判定与手工期望一致。
- [ ] 5.7 文本出现否决（D6）：对所有未证明活的候选名字（构造器除外），流式扫描 `source-manifest.json` 列出的文件（排除 `.excavator/`，NUL 字节即跳过并计数），整词切分、逐行计数；允许次数 = 该行声明数 + 该行被候选所在语言适配器记账为指向该候选的调用点数；记录第一处多余出现为证据；普查统计仅因解析器已另行解释的行而被否决的候选数。验证：单测覆盖规格「文本出现否决独立于解析器」三个场景，以及反射字面量、`@MethodSource`、XML 引用、Kotlin 文件、注释里的出现、仅声明处出现；二进制文件被跳过且计数可见。
- [ ] 5.8 产物 `.excavator/dead-code.jsonl`：复用 `jsonl-lines.mjs` 的按行读写；头部字段按规格「守恒、产物与有界查询」；写入与读取都断言五桶守恒；普查（按原因与注解名、按了结声明分组的 `suspect`、可能引用扇出与文本否决命中的前 50 名字、未归属来源引用的目标数、代码里的类字面量数、仅因解析器已另行解释的行而被否决的候选数）。验证：往返测试；制造一个漏桶变体，写入必须变红。
- [ ] 5.9 CLI：`node skills/excavator/dead-code.mjs <projectRoot>`，读 `.excavator/` 下的图谱、结构结果、清单与根目录声明，写产物，stderr 打印五桶计数；产物绑定 `factsDigest` 与声明摘要；不调用任何目标语言工具链。验证：对 `tests/fixtures/liveness-java/` 的小项目跑通 Lazy + CLI，输出与单测期望一致；在 `PATH` 里没有 `java` 的环境下结果相同。
- [ ] 5.10 绊线夹具与变异测试（D12）：`tests/fixtures/liveness-java/` 每种引用形态一个已知活方法，若干已知 dead 与已知 suspect 方法；断言活的都不是 `dead` / `suspect`、dead 的都是 `dead`、suspect 的都是 `suspect` 且了结声明正确；变异：去掉方法引用调用点且关闭文本否决后方法引用绊线变 `dead`；去掉 `overrides` 边后具体覆写绊线变 `dead`；去掉 `uncertainPairs` 后类型变量绊线变 `dead`。验证：三项断言全绿，三项变异各自变红。
- [ ] 5.11 夹具项目全链路变异（D12）：测试在临时目录生成 `tests/fixtures/liveness-java/` 的变体，只改源码文本——每种引用形态（`::`、反射字符串、`@MethodSource`、注解实参类字面量、Kotlin 调用、XML 条目）各加一行引用某个已知 `dead` 方法，跑 Lazy + CLI 后它必须离开 `dead`；删掉某个已知 `live` 方法的唯一引用行，它必须离开 `live`。验证：每个变体各自断言通过；不读写任何真实语料。

## 6. MCP 工具（切片 B）

- [ ] 6.1 `project-service.mjs` 新增 `deadCode({ mode, verdict?, nodeIds?, limit?, offset?, expectedRevision? })`：读产物并校验 `factsDigest` 与声明摘要，不一致返回 `stale-product`，缺失返回 `missing-product`；`census` / `list`（按五桶之一过滤，分页，`truncated` 与 `nextOffset`）/ `verdict`（≤20 个 id，`live` 返回按前驱重建的路径，`suspect` 返回了结声明）。`mcp-server.mjs` 注册 `dead_code`。验证：MCP 单测覆盖三种模式与两个终态；工具数 8。
- [ ] 6.2 `deploy/mcp-smoke.mjs` 扩到 8 个工具（`dead_code census`）。验证：对夹具项目运行通过。

## 7. Skill（切片 C）

- [ ] 7.1 新增 `skills/excavator-dead-code/SKILL.md`（英文）：按 D11 的五步；声明提议必须逐条带证据，只读构建文件文本、不执行构建；写入 `.excavator-liveness.json` 前必须经人确认；汇报模板分「dead 簇」「suspect 按了结声明」「收益最大的未声明项」「残余假设」四段；禁止把 `undetermined` 或 `suspect` 说成 dead。`node scripts/check-refs.mjs` 通过；插件清单登记该 skill。验证：`check-refs` 与读取 skill 文件的测试通过。

## 8. 验收（全部 build-free）

- [ ] 8.1 全量门：`pnpm install --frozen-lockfile`、`pnpm -r build`、`pnpm test`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`、Python 测试。
- [ ] 8.2 Fineract 无声明与带声明两次运行：五桶计数与守恒、普查、`dead` 与 `suspect` 列表；声明每条附依据；报告 `suspect` 了结后的去向。
- [ ] 8.3 Fineract 独立审读（门）：干净上下文的独立代理按引用形态清单逐条猎错，`dead` 全查或 ≥60 条分层样本 0 假阳性；30 条 `suspect`、30 条 `undetermined`、30 条 `live` 按 design「验收」核对。
- [ ] 8.4 真实语料绊线（门）：design「验收」列出的已知活方法全部不是 `dead` / `suspect`，报告判定与原因；用确定性查询报告继承实现的数量并核对一例。
- [ ] 8.5 夹具项目全链路变异（门）：5.11 的全链路变异在全量门里通过；真实语料全程只读，验收记录证明没有复制或改动任何语料。
- [ ] 8.6 文本交叉核对（门）：每个 `dead` 与 `suspect` 方法的 `git grep -nw` 逐行出现次数不超过允许次数。
- [ ] 8.7 kotlin-portal 跨语言（门）：被 Kotlin 调用的 Java 方法为 `undetermined`，证据指向 `.kt`；Kotlin 调用点不计入允许次数。
- [ ] 8.8 go-multirepo-auth、go-multirepo-service-v2、mixed-suite/maui-app：全部 `undetermined`（`language-not-covered`）、`dead` 与 `suspect` 为 0、守恒成立、factsDigest 与改前相同。
- [ ] 8.9 hadoop：Lazy 与 CLI 在默认堆下完成；Lazy 同条件 A/B 增幅 ≤30%；CLI 用时、内存、产物大小报告。
- [ ] 8.10 MCP 冒烟 8 个工具通过；`missing-product` 与 `stale-product` 各一个用例。
- [ ] 8.11 build-free（门）：验收记录证明没有调用目标语言工具链、没有安装运行时、没有依赖下载；无 JDK 环境下 CLI 对 Fineract 的产物与有 JDK 环境逐字节相同。

验收结果写入 design.md「验收结果」。

## 9. 归档

- [ ] 9.1 规格增量同步到 `openspec/specs/dead-code/spec.md`、`openspec/specs/fact-graph/spec.md`、`openspec/specs/mcp-tool-surface/spec.md`，变更移入 `openspec/changes/archive/`，`openspec validate --all --strict` 通过。
