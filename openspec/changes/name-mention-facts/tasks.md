执行约束：一 coder（Sonnet）一 acceptor（Opus）；验收 oracle 见 design.md「验收 Oracle」，动手前已写死。代码、测试与注释用英文，OpenSpec 用中文。全程 build-free：不编译、不安装运行时、不下载依赖。分支 `feat/name-mention-facts` 基于 `main`（dead-code-detection 切片 A 已合入，与本变更共用 `build-fact-graph.mjs`、`retrieve.mjs` 与版本号）。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): propose name-mention-facts`：proposal、design、规格增量、tasks。
1. `feat(mentions): lex class-name and path mentions from non-code files`：任务 1.1–1.3。
2. `feat(facts): resolve mentions into edges, gaps and coverage`：任务 2.1–2.4。
3. `feat(lazy): run the mention stage and traverse mentions edges`：任务 3.1–3.4。
4. `docs(openspec): record name-mention-facts acceptance`：任务 4.1–4.2。

## 1. 单文件词法

- [x] 1.1 新建 `skills/excavator/text-mentions.mjs`，导出纯函数 `(path, language, text, { extensions }) → { fqn: [], path: [] }`。候选包含 token、行号与上下文。注释遮蔽与切分规则按 design D3：遮蔽保留行号；路径候选按 manifest 扩展名集合过滤；URL 与 EL 不算路径。验证：`tests/facts/text-mentions.test.mjs` 覆盖规格「非代码文件中的名称提及」的三个场景，以及 CRLF、多行注释夹活动标记的行号、JSP 指令上下文、属性值与元素文本两种上下文。
- [x] 1.2 导出「是否代码语言」判定，从语言注册表的 tree-sitter 配置派生，不手写清单。验证：测试断言 `java`、`typescript`、`kotlin` 是代码语言，`xml`、`jsp`、`xhtml`、`properties`、`shell`、`sql` 不是。断言要读注册表，不能硬编码 15 这个数。
- [x] 1.3 变异绊线：关掉注释遮蔽后至少一条测试变红。验证：在测试里用注入开关或等价方式证明（不改生产默认值）。

## 2. 跨文件解析

- [x] 2.1 `buildFactGraph` 接收可选的 `mentionSites`。类名解析按 design D4：顶层类型字典、`$` 归一、最长前缀至少两段、id 为 null 或多声明时记歧义、其它 JVM 声明记未建索引、其余计入 `external`。验证：`tests/facts/name-mention-facts.test.mjs` 覆盖规格「类全限定名提及生成 mentions 边」的四个场景，另加：同一全限定名两模块的身份夹具、默认包类型不匹配、`.class` 与常量后缀、多级 `$`。
- [x] 2.2 路径解析按 design D5：web 根、相对、web 根兜底、后缀；模式展开；自指不成边。验证：同一测试文件覆盖规格「路径提及生成 mentions 边」的七个场景，另加 `classpath*:` 与 `*` 模式全收、`**` 跨段、后缀按段边界、`../` 开头的后缀匹配、自指。
- [x] 2.3 边、缺口、覆盖与守恒按 design D6：每对（source, target）一条边，证据逐行升序去重，字段齐全；三类缺口的样例格式与计数单位符合规定；覆盖记 `status`、按语言的文件数、候选数与去向计数；两条守恒等式不平衡时抛错；`mentionSites` 缺省时覆盖为 `not-run`、无边。验证：测试覆盖规格「mentions 边的证据与遍历」的「同一文件多次提及合为一条边」，并对守恒失败与 `not-run` 各有一条断言。
- [x] 2.4 变异绊线：关掉歧义判断（多声明时取第一个）、关掉 web 根规则、最长前缀改成最短前缀，每个变异各自至少让一条测试变红。验证：同 1.3 的方式证明。

## 3. 接入流水线

- [x] 3.1 `lazy-analyze.mjs` 在 importMap 之后新增 `mentions` 阶段：按 manifest 从物化快照读内容，跳过代码语言，产出逐文件候选传给 `buildFactGraph`；阶段计入 `time()` 与 stages 输出。验证：在小型 JSF 夹具项目上跑 Lazy，产物里出现预期的 `mentions` 边，stages 行含 `mentions=`。
- [x] 3.2 `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 加入 `mentions`，注释写明来源与理由。验证：测试覆盖规格场景「从类遍历到装配它的描述符」。
- [x] 3.3 `PIPELINE_VERSION` 升到 `lazy-fact-graph/6`，注释写明新增的事实；因新边、新覆盖段变化的冻结摘要整块重冻。验证：三件套、core 测试与 typecheck 全绿；commit 说明列出每个变化的摘要及原因。
- [x] 3.4 检查是否有其它边类型白名单或校验（schema、`validate-graph.mjs` 的期望 token、`annotate-graph.mjs`）会拒绝或误判 `mentions` 边，按需最小修改。`validate-graph.mjs` 对 `mentions` 的期望 token 取证据里的原 token：模式命中的目标文件名不在证据行上。验证：在 3.1 的夹具产物上跑图校验，无新增告警；说明每处查过的位置及结论。

## 4. 验收与记录

- [ ] 4.1 acceptor 按 design「验收 Oracle」O2–O7 在固定语料上验收。每项给出命令、计数和结论，编造与遗漏分开计数；报告存在仓库外。验证：报告中每项 oracle 都有通过 / 不通过结论和证据。
- [ ] 4.2 全量门 O8 通过后，把验收摘要写进本文件末尾。摘要只放计数、耗时、结论，不放真实项目的源码或路径。验证：`openspec validate --all --strict` 通过。
