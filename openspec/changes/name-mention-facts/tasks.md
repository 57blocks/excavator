执行约束：一 coder（Sonnet）一 acceptor（Opus）；验收 oracle 见 design.md「验收 Oracle」，动手前已写死。代码、测试与注释用英文，OpenSpec 用中文。全程 build-free：不编译、不安装运行时、不下载依赖。分支 `feat/name-mention-facts` 基于 `main`（dead-code-detection 切片 A 已合入，与本变更共用 `build-fact-graph.mjs`、`retrieve.mjs` 与版本号）。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): propose name-mention-facts`：proposal、design、规格增量、tasks。
1. `feat(mentions): lex class-name and path mentions from non-code files`：任务 1.1–1.3。
2. `feat(facts): resolve mentions into edges, gaps and coverage`：任务 2.1–2.4。
3. `feat(lazy): run the mention stage and traverse mentions edges`：任务 3.1–3.4。
4. `fix(facts): count non-node Java declarations as unindexed mentions`：任务 2.5（验收阶段 A 的发现，规格与 design 同步修订）。
5. `fix(mentions): stop suffix fall-through for patterns and bare names`：任务 2.6（验收阶段 B 的编造来源）。
6. `fix(facts): ground unindexed mentions in what the repository holds`：任务 2.7（验收阶段 B 的错误声明与不可见遗漏）。
7. `docs(openspec): record name-mention-facts acceptance`：任务 4.1–4.2。

## 1. 单文件词法

- [x] 1.1 新建 `skills/excavator/text-mentions.mjs`，导出纯函数 `(path, language, text, { extensions }) → { fqn: [], path: [] }`。候选包含 token、行号与上下文。注释遮蔽与切分规则按 design D3：遮蔽保留行号；路径候选按 manifest 扩展名集合过滤；URL 与 EL 不算路径。验证：`tests/facts/text-mentions.test.mjs` 覆盖规格「非代码文件中的名称提及」的三个场景，以及 CRLF、多行注释夹活动标记的行号、JSP 指令上下文、属性值与元素文本两种上下文。
- [x] 1.2 导出「是否代码语言」判定，从语言注册表的 tree-sitter 配置派生，不手写清单。验证：测试断言 `java`、`typescript`、`kotlin` 是代码语言，`xml`、`jsp`、`xhtml`、`properties`、`shell`、`sql` 不是。断言要读注册表，不能硬编码 15 这个数。
- [x] 1.3 变异绊线：关掉注释遮蔽后至少一条测试变红。验证：在测试里用注入开关或等价方式证明（不改生产默认值）。

## 2. 跨文件解析

- [x] 2.1 `buildFactGraph` 接收可选的 `mentionSites`。类名解析按 design D4：顶层类型字典、`$` 归一、最长前缀至少两段、id 为 null 或多声明时记歧义、其它 JVM 声明记未建索引、其余计入 `external`。验证：`tests/facts/name-mention-facts.test.mjs` 覆盖规格「类全限定名提及生成 mentions 边」的四个场景，另加：同一全限定名两模块的身份夹具、默认包类型不匹配、`.class` 与常量后缀、多级 `$`。
- [x] 2.2 路径解析按 design D5：web 根、相对、web 根兜底、后缀；模式展开；自指不成边。验证：同一测试文件覆盖规格「路径提及生成 mentions 边」的七个场景，另加 `classpath*:` 与 `*` 模式全收、`**` 跨段、后缀按段边界、`../` 开头的后缀匹配、自指。
- [x] 2.3 边、缺口、覆盖与守恒按 design D6：每对（source, target）一条边，证据逐行升序去重，字段齐全；三类缺口的样例格式与计数单位符合规定；覆盖记 `status`、按语言的文件数、候选数与去向计数；两条守恒等式不平衡时抛错；`mentionSites` 缺省时覆盖为 `not-run`、无边。验证：测试覆盖规格「mentions 边的证据与遍历」的「同一文件多次提及合为一条边」，并对守恒失败与 `not-run` 各有一条断言。
- [x] 2.4 变异绊线：关掉歧义判断（多声明时取第一个）、关掉 web 根规则、最长前缀改成最短前缀，每个变异各自至少让一条测试变红。验证：同 1.3 的方式证明。
- [x] 2.5 仓库内存在、却不在 Java 字典里的声明计入 `unindexed`，不计入 `external`。验收阶段 A 发现 Core 不为注解类型 `@interface` 建 class 节点，这类类型于是被当成仓库外。按「目录以包路径结尾、文件名为类型名」判定 Java 源文件，与 Kotlin / Scala 的判定一致；Java 文件不带 `Kt` 规则。验证：测试覆盖规格场景「不是节点的仓库声明不算仓库外」，包括带成员后缀的注解类型；输入行的形状取自 Core 对只含注解类型的文件的真实输出。夹具新增一个注解类型及其提及，Lazy 产物里出现该 `mention-target-unindexed` 缺口；冻结摘要如受影响则整块重冻。
- [x] 2.6 路径解析按修订后的 D3 / D5 执行。第 4 条规则只收带 classpath 前缀的 token，以及非模式、含目录段的 token；不带 classpath 前缀的模式与裸文件名不做后缀匹配。开头的 `/`、`./`、`../` 之后再出现 `.` / `..` 段的 token 记未解析。判断通配候选时，`.` / `..` 不算字面目录段。JSP 指令的上下文取指令本身，不取外层元素。D3 的右边界只改 design 文字，与实现对齐，不改代码。验证：测试覆盖规格场景「构建描述符里的模式不跨模块」「裸文件名不按后缀匹配」，另加：`./*.ts` 不是候选；相对目录有命中时 `./` 前缀的普通路径照常成边；`$VAR/../x.sh` 记未解析；`classpath:` 裸文件名与 `classpath*:` 模式仍走后缀；`<script>` 内的 `<%@ include file %>` 上下文为 `%@include`。变异绊线：恢复模式的后缀兜底，至少一条测试变红。
- [ ] 2.7 「未建索引」只对仓库里确实存在的东西成立。（a）类名：Java 侧改读文件自己声明的 `package`，不再看目录后缀。Lazy 的 `mentions` 阶段为文件名对应类型不在字典里的 Java 文件读出包声明（读前遮蔽注释），连同被跳过的 `.java` 文件一并传给 `buildFactGraph`。Kotlin / Scala 不变。（b）路径：目标范围加入以处理原因被跳过的文件；唯一命中这类文件记 `mention-target-unindexed`；模式命中里这类文件计入 `path.unindexedHits`，只命中这类文件时记未建索引；路径守恒加入未建索引。（c）覆盖新增 `skipped`：按原因统计未扫描的非代码文件数。验证：测试覆盖规格场景「目录名像包名不等于声明了该类型」「存在但被跳过的文件不算不存在」，以及模式命中混有被跳过文件的情形、守恒失败的断言。夹具与 Lazy 管道测试各加一个端到端断言。变异绊线：改回目录后缀判定，至少一条测试变红。

## 3. 接入流水线

- [x] 3.1 `lazy-analyze.mjs` 在 importMap 之后新增 `mentions` 阶段：按 manifest 从物化快照读内容，跳过代码语言，产出逐文件候选传给 `buildFactGraph`；阶段计入 `time()` 与 stages 输出。验证：在小型 JSF 夹具项目上跑 Lazy，产物里出现预期的 `mentions` 边，stages 行含 `mentions=`。
- [x] 3.2 `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 加入 `mentions`，注释写明来源与理由。验证：测试覆盖规格场景「从类遍历到装配它的描述符」。
- [x] 3.3 `PIPELINE_VERSION` 升到 `lazy-fact-graph/6`，注释写明新增的事实；因新边、新覆盖段变化的冻结摘要整块重冻。验证：三件套、core 测试与 typecheck 全绿；commit 说明列出每个变化的摘要及原因。
- [x] 3.4 检查是否有其它边类型白名单或校验（schema、`validate-graph.mjs` 的期望 token、`annotate-graph.mjs`）会拒绝或误判 `mentions` 边，按需最小修改。`validate-graph.mjs` 对 `mentions` 的期望 token 取证据里的原 token：模式命中的目标文件名不在证据行上。验证：在 3.1 的夹具产物上跑图校验，无新增告警；说明每处查过的位置及结论。

## 4. 验收与记录

- [ ] 4.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收。每项给出命令、计数和结论，编造与遗漏分开计数；报告存在仓库外。验证：报告中每项 oracle 都有通过 / 不通过结论和证据。
- [ ] 4.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时、结论，不放真实项目的源码或路径。验证：`openspec validate --all --strict` 通过。
