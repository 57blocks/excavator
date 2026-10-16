提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入；每个 PR 单独可测、可合入；全程 build-free）：

- **PR 1（重新设计与清理）**
  1. `docs(openspec): propose unused-code`：proposal、design、规格、tasks。
  2. `refactor(facts): drop the Java call-resolution report mode`：任务 1.1–1.2。
  3. `docs(openspec): archive dead-code-detection`：任务 1.3。
- **PR 2（确定性候选集）**
  4. `docs(openspec): refine the unused-code census and candidate product`：普查按直接引用者体内解释、读源码核对摘要、候选集产物形状、O2 的路由绊线移到决定之后。
  5. `feat(unused-code): candidate set and clusters`：任务 2.1–2.2。
  6. `feat(unused-code): name occurrence census`：任务 2.3。
  7. `docs(openspec): record unused-code candidate measurements`：任务 2.4。
- **PR 3（入口判断、报告与查询）**
  8. `feat(unused-code): apply entry decisions and confidence`：任务 3.1–3.2。
  9. `feat(skill): excavator-unused-code`：任务 4.1。
  10. `docs(skill): chat answers from the unused-code product`：任务 4.2。
  11. `docs(openspec): record unused-code acceptance and archive`：任务 5.x。

## 1. 清理已有实现（PR 1）

- [x] 1.1 `skills/excavator/java-call-resolution.mjs` 删除报告模式（design D8）。
  - 删除的部分：
    - `resolveFileCalls` 的 `{ report }` 选项；
    - `reportSite`、`candidateIds`、`probeSite` 与 `probes` / `probing` 状态，以及接收者里的 `site.probe` 分支；
    - 结果上的 `lookupType`、`outsideHierarchy` 与歧义结果的 `candidates`（含 `unionOfCandidates`、`ambiguousResult` 的候选参数）。
  - 删除文件头与 `hierarchyEdges` / `resolveFileCalls` 文档注释里关于报告模式的段落。
  - 按类型注入的类型查询仍在用的部分不动（`ambiguousAmong` 的 `types`、`methodsMaybeOutside` 等），以 grep 核实。
  - 验证：全量测试通过。
- [x] 1.2 删除 `tests/facts/java-call-report-mode.test.mjs`。
  - 其它测试里断言报告模式字段的用例同步删除；不改动任何断言非报告模式输出的用例。
  - 验证（O0）：cargotracker 与 dataverse 的副本上，删除前后 Lazy 产出的 `fact-graph.jsonl` 逐字节相同。
- [x] 1.3 归档 `dead-code-detection`。
  - 在 proposal、design、tasks 开头写明结局：切片 A 已由 PR 57blocks/excavator#13 合入；判定部分由 `unused-code` 取代、未实施；报告模式（D13）已由本变更删除。
  - 未实施的任务改为说明文字，不留复选框。
  - 删除未实施的 `specs/dead-code/spec.md` 与 `specs/mcp-tool-surface/spec.md` 增量。
  - 把 `specs/fact-graph/spec.md` 增量同步进 `openspec/specs/fact-graph/spec.md`，去掉其中关于报告模式的句子与场景。
  - 移入 `openspec/changes/archive/2026-10-16-dead-code-detection/`；`skills/excavator/frameworks/README.md` 里的例子「dead-code roots」改为「unused-code candidates」。
  - 验证：`openspec validate --all --strict`。

## 2. 确定性候选集（PR 2）

- [x] 2.1 新增 `skills/excavator/unused-code.mjs` 的纯函数部分与 `candidates` CLI（`node skills/excavator/unused-code.mjs candidates <projectRoot>`）。
  - 读 `.excavator/intermediate/fact-graph.jsonl`、`.excavator/intermediate/structure-all.jsonl` 与 `.excavator/source-manifest.json`。
  - 按 D3 求路由可达集、候选、强连通分量、簇入口，以及每个候选在候选之间的直接引用者。
  - 写 `.excavator/unused-candidates.json`：头部有 `factsDigest`、计数（函数节点总数、路由可达、候选、入口、簇，按语言）与守恒；每个候选带特征。
  - 守恒不等即非零退出、不写产物。
  - 验证：合成事实图单测覆盖规格「未使用代码的定义」「确定性候选集」的场景；双向覆写与守恒各有一个变红用例（O1）。
- [x] 2.2 候选特征。
  - 从结构结果按（文件、名字、行区间）对上函数节点，取可见性、修饰符、方法注解；所属类型的注解与父类型文本。
  - 用事实图的 `inherits` / `implements` 类型边判断父类型是否在索引里，沿祖先与后代传播。
  - 所属类型的入边 `references` / `injects` / `mentions` 来源，以及它在注解实参类字面量里的出现。
  - 结构结果没有的字段记为未知。
  - 验证：小型 Java 夹具的单测逐字段核对。
- [x] 2.3 名字出现普查（D5）。
  - 逐个读选中文件：工作区按清单 `contentHash` 核对，不一致改读源码快照，仍不一致即失败；跳过含 NUL 的文件并计数。
  - 已解释的出现只有本节点声明行上的 1 次与直接引用者体内的出现；其余记为别处出现，总数不截断、位置样例截断。
  - 名字不是纯标识符的节点普查记为未知；统计「别处出现全在同名声明行上」的候选数。
  - 验证：单测覆盖规格「名字出现普查」全部场景、注释里的出现、声明行上的第二次出现；去掉反射那一行后计数归零，证明装置看得见（O1）。
- [x] 2.4 真实语料确定性运行（O2）：Fineract（f9c2fcd）、dataverse、hadoop 的副本上先运行 Lazy，再运行 `candidates`。
  - build-free：只用 Node 与 Lazy，不编译、不装 Java 运行时或构建工具、不拉依赖。
  - 报告计数、各特征分布、用时、峰值内存、产物大小；Fineract 绊线中候选集阶段能判的部分（带 HTTP 方法注解的候选都能被路由缺口或 Retrofit 接口解释；三个绊线方法的特征与普查）。
  - 结果写入 design.md「测量记录」。

## 3. 入口决定与可信度（PR 3）

- [ ] 3.1 `report` CLI（`node skills/excavator/unused-code.mjs report <projectRoot> [--decisions <file>]`，默认 `.excavator/unused-decisions.json`）。
  - 校验决定文件：种类、理由、查询、id 都在候选集里、不重复、摘要一致。
  - 用候选集里的引用表从决定出发求「经决定移出」与 `test-only`；其余为未使用，标 `unreferenced` 或 `only-reachable-from-unused` 并列出直接引用者；未使用节点按弱连通分量分组，每组列出入口。
  - 守恒不等即非零退出。
  - 验证：单测覆盖规格「入口判断由宿主 skill 承担」与「产物、新鲜度与查询」的场景。
- [ ] 3.2 可信度规则（D6）与产物 `.excavator/unused-code.json`。
  - 头部有摘要、计数、残余假设；全部决定与命中数；全部候选的原因、可信度、信号、簇；`test-only`。
  - 可信度上限在缩点图上按拓扑序计算（D3）。
  - 验证：单测覆盖规格「可信度规则」四个场景、「没有可见性事实的语言不给 `high`」，以及一个经两层成员传递上限的用例。

## 4. Skill 与查询（PR 3）

- [ ] 4.1 新增 `skills/excavator-unused-code/SKILL.md`（英文）。
  - 步骤：
    1. 确认事实新鲜，必要时运行 Lazy；
    2. 运行 `candidates`；
    3. 用给定的 `jq` 配方按特征给入口分组，读已检测框架的附录，对每组抽读源码后决定；
    4. 用查询生成 id 写决定文件；
    5. 运行 `report`；
    6. 汇报。
  - 汇报分段：`high` 按簇、`medium` 按模块与类、`low` 按信号计数、`test-only` 计数、决定摘要、残余假设。
  - 每条规则写在模型做那个决定的步骤里。
  - 禁止手抄 id；禁止把 `medium` / `low` 说成确定未使用；禁止删改代码。
  - 插件清单登记该 skill。
  - 验证：`node scripts/check-refs.mjs`；读取 skill 文件的契约测试把每条规则钉在它的步骤里。
- [ ] 4.2 `skills/excavator-chat/SKILL.md`：
  - 问到未使用代码时读 `.excavator/unused-code.json`，先比对 `factsDigest`；
  - 按 id、名字或文件回答；产物缺失或过期时如何回答。
  - 验证：契约测试；`check-refs`。

## 5. 验收与归档

- [ ] 5.1 真实模型（O3）：Sonnet 在 dataverse 与 Fineract 的副本上执行 skill（限预算，不并行），独立 Opus 代理审读。
  - 全部 `high` 0 条在用（门）；
  - 30 条 `medium`、20 条 `low` 的信号属实；
  - 20 条决定的理由成立。
- [ ] 5.2 全量门（O4）：vitest、`check-refs`、`openspec validate --all --strict`。
- [ ] 5.3 验收记录写入 design.md；规格同步到 `openspec/specs/unused-code/spec.md`，变更移入 `openspec/changes/archive/`。
