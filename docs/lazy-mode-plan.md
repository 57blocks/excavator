# Excavator Lazy 模式实施计划

状态：设计完成，待实施  
日期：2026-09-12  
范围：`/excavator`、`/excavator-chat`、`/excavator-diff`、`/excavator-explain`、`/excavator-onboard`、`/excavator-domain`、知识图谱持久化与增量更新  
评审：已纳入 GPT-6 以及二次架构 Review 对快照抽象、非 Git 支持、检索召回、多跳遍历、数据隔离、节点身份和缓存并发的反馈
评审（2026-09-14，对照 v2 现有代码）：对照 `structure-all.mjs`、`prepare-incremental.mjs`、`excavator-chat` 复核后补齐——节点身份契约（去重唯一支点，§4.1）、按需语义为何不产生重复数据（§7.3/§8）、缓存锁的陈旧处理（§8）、worktree 隔离与 issue #133 的冲突（§10）、HEAD-only 快照对 chat 的行为变化（§3.1）、事实层是对现有确定性抽取的投影（§4）、以及把检索引擎从"子步骤"重切为独立切片（§11）。

## 1. 目标

把首次分析从“全项目逐文件调用 LLM”改成物理隔离的两层知识：

1. **事实层**由确定性脚本快速生成，记录文件、符号、导入、调用、行号和覆盖缺口，LLM 永远不能修改。
2. **语义层**由 LLM 生成摘要、标签和语义关系；Lazy 模式在问答确实需要时才补充，Full 模式在显式分析时集中生成，并存入独立文件。

期望结果：

- Lazy 首次运行不调用分析、校验或架构 subagent。
- 小型项目首次运行目标不超过 60 秒；这是性能观测目标，不是正确性门槛。
- 问答始终基于一个具有稳定 revision 的源码快照。
- Full 与 Lazy 共用同一事实层，不维护两套结构分析机制。
- 产品只提供分析产物和终端问答，不恢复 HTML、Dashboard、Viewer 或 Tour。

**"Lazy" 的准确含义**：Lazy 去掉的是**首次运行的逐文件 LLM 批处理**（file-analyzer / summary-verifier / assemble-reviewer / architecture-analyzer / graph-reviewer 五类 subagent，对应 v2 `skills/excavator/SKILL.md` 的 Phase 2 / 2.5 / 3 / 4 / 6）。Chat 本身仍会调用模型——用于查询扩展（§7.1）和最终回答；按需语义补充（§7.3）也会调用模型。因此 Lazy ≠ "问答不再用 LLM"，而是"不在分析前一次性烧掉整仓的 LLM 预算"。

## 2. 已确定的产品边界

### 2.1 两种模式

`.excavator/config.json` 增加：

```json
{
  "analysisMode": "lazy"
}
```

允许值：

- `lazy`：只预建确定性事实；语义信息按问答需要补充。
- `full`：显式运行 `/excavator` 时，先重建事实，再为缺失或过期文件补齐语义信息和架构总结。

默认值为 `lazy`。

命令行规则：

- `/excavator --mode=lazy` 或 `/excavator --mode=full` 只覆盖本次运行，不改配置。
- 现有 `/excavator --full` 保留为一次性别名，等价于 `--mode=full` 加强制重建事实，不持久化配置。
- `/excavator-chat` 不要求用户选择更新策略；它始终先做轻量的新鲜度检查。

**存量迁移**：默认值翻转为 `lazy` 不得破坏已存在的 `.excavator/` 产物。若项目已有完整的 `knowledge-graph.json`（含非空 summary / layers）与 `semantic-graph.json`，切到 lazy 默认后：事实层照常按 sourceRevision 增量同步，已有语义按 §7.4 的 hash 规则复用或失效，**不清空、不降级**已生成的语义；只有显式 `/excavator --mode=full` 才会主动补齐。首次从 pre-lazy 布局升级时，若缺 `source-manifest.json` / `factDigest`，做一次性确定性重建补齐这些键，语义缓存按新 manifest 重新判断新鲜度。

## 3. SourceSnapshot 与源码版本

分析、检索和源码取证统一依赖 `SourceSnapshot`，不能各自直接读取 Git 或工作目录：

```typescript
interface SourceSnapshot {
  readonly revision: string;
  listFiles(): Promise<SourceFile[]>;
  readFile(path: string): Promise<Uint8Array>;
  search(terms: string[]): Promise<SourceMatch[]>;
  diff(previous: SourceManifest): Promise<SourceDiff>;
}
```

`revision` 是源码版本的唯一基线，持久化为 `project.sourceRevision`。现有 `gitCommitHash` 和 `sourceDigest` 可以继续记录审计信息，但不得再分别决定图谱是否新鲜。

`source-manifest.json` 另外记录 `selectionDigest` 和 `pipelineVersion`。前者覆盖生效的 ignore/exclude 规则，后者覆盖抽取器版本。源码 revision、selectionDigest 或 pipelineVersion 任一变化，都必须重建受影响的确定性产物。

### 3.1 GitCommitSnapshot

Git 项目的 revision 为：

```text
git:<full-head-sha>
```

行为：

- 文件清单来自 `git ls-tree`；
- 文本搜索使用 `git grep ... HEAD`；
- 源码读取使用 `git show HEAD:<path>`；
- 确定性抽取读取 Git blob，或读取 `git archive HEAD` 生成的临时快照；
- `.excavatorignore` 也从 HEAD 读取，未提交的 ignore 变化不生效；
- staged、unstaged 和 untracked 内容全部忽略；
- 终端显示 `Analyzing git:<short-sha>; uncommitted changes ignored`。

只要 HEAD 不变，工作区变化不得改变图谱、索引、语义缓存或回答引用的源码。

**这会改变 v2 当前 chat 行为**：现 `excavator-chat` 会检查 staged/unstaged/untracked 并在回答前 **warn**（见 `skills/excavator-chat/SKILL.md`）。改为 HEAD-only 后，Git 项目里"我刚改了还没提交"的问题会按 HEAD 回答、忽略工作区改动，只在终端给一行提示。这是为确定性主动做的取舍——务必让该提示显著（例如每次回答前打印 `Analyzing git:<short-sha>; N uncommitted file(s) ignored — commit or use a non-git checkout to include them`），避免用户误以为回答覆盖了未提交改动。

### 3.2 MultiRepoSnapshot

根目录本身不是 Git 仓库、但包含多个成员仓时，使用：

```text
multi-repo:<sha256(sorted member path + member HEAD)>
```

每个成员仓都按 `GitCommitSnapshot` 读取。成员仓的 staged、unstaged 和 untracked 内容同样忽略；不得把多仓父目录误判为普通目录后读取成员仓工作区。父目录中不属于任何成员仓的源码按 DirectorySnapshot 读取并计入 multi-repo digest；父目录生效的 ignore/exclude 规则进入 selectionDigest。

### 3.3 DirectorySnapshot

普通非 Git 目录使用：

```text
directory:<manifest-digest>
```

`manifest-digest` 对按路径排序后的 `{ path, contentHash }` 清单计算 SHA-256。文件清单沿用 scan 与 `.excavatorignore` 规则，`.excavator/` 始终排除。

DirectorySnapshot 的当前磁盘内容就是权威输入：

- 新增、修改和删除文件都会形成新 revision；
- 临时文件通过 `.excavatorignore` 排除；
- Excavator 不执行 `git init`，也不自动创建提交；
- 用户手动初始化 Git 后，下一次运行自动改用 `GitCommitSnapshot`。

### 3.4 快照一致性

DirectorySnapshot 可能在扫描期间继续变化，因此发布前必须执行 revision guard：

1. 建立 manifest，并让每次 `readFile` 校验预期 content hash。
2. 所有图谱和索引先写入临时文件。
3. 发布前重新计算 manifest digest。
4. revision 不一致时丢弃临时结果并重试一次。
5. 第二次仍变化则停止，保留旧图谱和旧 revision。

Chat 读取非 Git 源码时也必须校验文件 hash；不匹配时先同步新快照，不得用旧图配新源码回答。

## 4. 统一的确定性事实层

新增一个权威构建器，例如：

```text
skills/excavator/build-fact-graph.mjs
```

**它主要是"投影"，不是新抽取器**。v2 已有的 Phase 1.2 `structure-all.mjs` 已确定性产出每个文件的：`status`（`parsed`/`zero-symbol`/`no-extractor`/`parse-failed`）、带行号的声明、带行号的 imports/exports、以及 call sites；import-map 已解析项目内部导入。Fact Builder 的职责是把这些 + import-map 规范化为事实节点/边，算 coverage / gaps / fingerprints 与 factDigest，**不重新解析源码**。唯一真正的新增确定性工作是"把 call site 唯一解析到目标节点"（§4.2）——解析不了就写 gap，绝不猜。

输入：

- SourceSnapshot 的扫描结果；
- `structure-all` 的结构抽取结果；
- import map；
- source manifest 与 revision。

输出：

- `knowledge-graph.json` 的确定性事实投影；
- coverage 与 gaps；
- fingerprints；
- fact digest。

`factDigest` 只覆盖规范化后的事实节点、事实边、coverage 和 gaps；排除 sourceRevision、时间戳、模型名和其他运行元数据。因此相同源码内容通过不同 SourceSnapshot adapter 分析时可以得到相同 factDigest。

### 4.1 事实节点

必须支持：

- file；
- function / method；
- class / interface 等当前抽取器可靠支持的声明；
- 当前脚本能够确定性识别的配置、路由或其他非代码节点。

节点 ID 优先使用：

```text
path + kind + owner + normalized signature
```

缺少签名时使用 name；以上字段仍无法区分时，声明序号只能作为最后兜底。禁止把不同 receiver、class 或 owner 下的同名方法合并。

#### 节点身份契约（去重的唯一支点）

按需语义缓存按**节点 ID**去重（§7.3 / §8）——同一逻辑节点每次必须得到同一个 ID，否则一个节点会出现两条缓存、并产生"有事实节点却无对应语义"的悬挂。因此节点身份是整套 Lazy 缓存正确性的**单点支柱**，必须由一处实现、Fact Builder 与 Chat 查缓存两侧**共用同一函数**，不得各算各的。

必须成立的不变量：

1. **确定性**：同一源码内容，重复运行得到逐字节相同的 ID。
2. **跨 adapter 稳定**：同一逻辑文件，无论经 GitCommitSnapshot（git blob 路径）、DirectorySnapshot（相对路径）还是 MultiRepoSnapshot（带成员前缀的路径）分析，规范化后得到同一 path 分量，从而同一 ID。多仓成员前缀规则要写死（如 `<memberId>/<member-relative-path>`），它是 factDigest 跨 adapter 一致（§12.4.1）的前提。
3. **可区分维度不坍缩**：不同 receiver / class / owner 下的同名方法、签名不同的重载，必须是不同 ID（守恒过得了坍缩，靠可区分维度判定，不靠计数）。
4. **匿名/难命名构造有稳定兜底**：匿名函数、箭头常量、默认导出的匿名 handler、闭包内声明等没有稳定 name/signature 的节点，兜底顺序为 `path+kind+owner+signature` → `path+kind+owner+name` → **owner 内同 kind 声明的出现序号**。序号是脆弱兜底：在它之前**新增一个同类声明**会改变序号（该节点语义缓存随之失效重算——可接受的偶发代价，不是错误）；但插入注释、空行或非同类代码不得改变它。序号必须记入 provenance 以标记这份脆弱性。
5. **与既有产物对齐**：ID 规范化必须与 v2 现有 `annotate-graph.mjs` / `structure-all.mjs` 的锚点一致，避免事实层与（迁移期仍存在的）旧语义层身份漂移。

验收夹具（Step / 切片 A 先写失败）：

- 同内容不同路径（git 相对 vs 目录相对 vs 多仓成员前缀）→ 同 ID；
- 同内容经 GitCommitSnapshot 与 DirectorySnapshot → 同 factDigest（§12.4.1 已列）；
- 同文件两个不同 receiver 的同名方法 → 两个不同 ID；
- 在匿名 handler 前插入注释 / 空行 / 非同类声明 → 该 handler ID 不变；在其前新增一个同类声明 → 该 handler ID 允许变化，但只表现为该节点缓存失效重算，**绝不张冠李戴到别的节点**；
- 重命名文件（git 未识别为 rename）→ 旧 ID 记为删除、新 ID 记为新增，语义缓存对旧 ID 失效而非错配到新节点。

### 4.2 事实边

必须支持：

- `contains`；
- `exports`；
- `imports`；
- 能唯一解析目标的 `calls`。

不能唯一解析的引用不得猜测，写入 gap。所有事实边保留 provenance 和源码证据。

### 4.3 基础字段

Lazy 图谱允许：

- `summary: ""`；
- `tags: []`；
- `layers: []`。

`complexity` 保持现有必填字段，不为 Lazy 单独修改 schema；按非空代码行数确定性生成：

- `< 50`：`simple`；
- `50–200`：`moderate`；
- `> 200`：`complex`。

精确阈值可在实现时通过现有 fixture 校准，但必须固定、可复现且不调用 LLM。

### 4.4 物理产物边界

| 文件 | 权威内容 | 写入者 |
|---|---|---|
| `source-manifest.json` | sourceRevision、selectionDigest、pipelineVersion、文件路径和 content hash | SourceSnapshot |
| `knowledge-graph.json` | 确定性节点、边、证据、coverage、gaps、factDigest | Fact Builder |
| `source-index.jsonl` | symbol-aware source chunks 的确定性词法索引 | Source Index Builder |
| `semantic-cache.json` | 节点局部 summary、tags、sourceHash、provenance | Chat / Full |
| `semantic-graph.json` | Full 生成的语义节点、关系和 layers | Full |
| `domain-graph.json` | 显式 Domain 分析产物 | Domain |

`knowledge-graph.json` 中的 `summary`、`tags`、`layers` 保持为空或确定性值。LLM 输出只能写入后三个语义产物，不能通过 merge、annotate 或 publish 回写 canonical fact graph。

## 5. Lazy 首次运行

流水线：

```text
Resolve SourceSnapshot
  -> Scan
  -> Import Map
  -> Structure-All
  -> Build Fact Graph
  -> Build Source Index
  -> Deterministic Validate
  -> Manifest + Fingerprints + Meta
  -> Atomic Save
```

要求：

- 不运行 Project Scanner subagent；扫描脚本本身保留。
- 不运行 File Analyzer、Summary Verifier、Assemble Reviewer、Architecture Analyzer 或 Graph Reviewer。
- 不执行 `compute-batches`，因为 Lazy 首次运行不产生 LLM 批次。
- 解析失败的文件进入 coverage/gaps，不能伪装成“无符号”或“已删除”。
- 保存失败时不得推进 `sourceRevision`、manifest、fingerprints 或 meta。

## 6. SourceRevision 增量同步

新增一个快照同步入口，例如：

```text
skills/excavator/sync-fact-graph.mjs
```

触发条件：

```text
current sourceRevision / selectionDigest / pipelineVersion
  != persisted source manifest
```

同步流程：

1. 比较旧 manifest 与当前 sourceRevision、selectionDigest 和 pipelineVersion。
2. Git 使用 commit diff；Directory 使用前后 manifest，得到新增、修改和删除文件。
3. 新增或修改文件重新抽取整个文件的结构，不尝试复用旧行号。
4. 删除对应事实节点和边；重命名即使未被 Git 识别，也可以按删除加新增正确处理。
5. 重新解析受影响的 imports、exports 和唯一可解 calls。
6. 重建受影响的 source chunks 和词法索引。
7. 重算 coverage、gaps、fingerprints 与 fact digest。
8. 原子保存全部确定性产物后才推进 source manifest。

SourceSnapshot adapter 类型发生变化，例如普通目录被用户初始化为 Git 仓库时，执行完整确定性重建，并按新 manifest 重新判断所有语义缓存。

采用**文件级失效**。文件 content hash 变化后，`semantic-cache.json` 中该文件对应的语义立即视为过期，不参与可信检索；不做低权重保留。

现有 `prepare-incremental.mjs` 已有非 Git content hash diff、删除检测和原子写入逻辑，可以复用。Git 路径当前会拒绝 staged、unstaged 和 untracked 变化，新入口改为通过 `GitCommitSnapshot` 读取 HEAD，因此工作区变化既不报错也不进入 diff。旧的 LLM 更新分类不进入统一事实同步入口。

## 7. Chat 闭环

每次 `/excavator-chat` 按以下顺序工作：

```text
Resolve SourceSnapshot
  -> Sync facts when snapshot inputs changed
  -> Hybrid retrieval
  -> Budgeted graph traversal
  -> Read snapshot source evidence
  -> Answer
  -> Optionally persist reliable local semantics
```

### 7.1 检索

Chat 使用同一次推理把用户问题展开成少量代码检索词，包括英文术语、常见代码同义词和可能的 identifier；不调度独立 query-expansion subagent。

候选节点由以下结果合并排序：

- 精确 symbol / node ID / file path 匹配；
- `source-index.jsonl` 中 symbol-aware chunks 的 BM25 检索；
- SourceSnapshot 的源码搜索；
- `semantic-cache.json` 中有效 summary / tags 的文本检索；
- revision 匹配的 `domain-graph.json` 提示。

source chunk 至少记录 path、owner、symbol、line range、拆分后的 identifier、注释和字符串字面量。索引按 sourceRevision 持久化；单文件变化只重建该文件 chunks。

语义缓存和 Domain 结果只能提供 seed，最终回答必须回到当前 SourceSnapshot 的原始源码或确定性事实边确认。

结构类问题，例如“有哪些菜单目录”“某类有哪些方法”，直接用事实层回答，不触发额外语义分析。

### 7.2 有预算的图遍历

不再固定为 1-hop。Chat 根据问题选择已有的确定性遍历原语：

| 问题 | 策略 |
|---|---|
| 定位、直接调用者 | 1-hop neighbors |
| 流程、依赖、影响范围 | bounded BFS，默认最多 4-hop |
| 明确 A 到 B | bounded shortest path，最多 6-hop |

默认预算：

- seed nodes ≤ 20；
- expanded nodes ≤ 80；
- expanded edges ≤ 160；
- 交给回答模型的检索上下文 ≤ 12,000 tokens。

达到预算时停止扩展，并在回答中说明只覆盖到的边界。遍历优先使用确定性边；语义边和 Domain step 只能辅助排序，不能替代源码证据。

### 7.3 按需语义补充

当问题需要理解职责、业务含义或局部行为时，Chat 在正常回答推理中读取必要源码，不再调度独立 File Analyzer subagent。

只有同时满足以下条件才写缓存：

1. 已读取该文件或节点所需的完整局部源码范围；
2. 能可靠概括该节点自身职责；
3. 写入内容不依赖未验证的跨文件推断。

可缓存字段限制为：

- 节点或文件自身的 `summary`；
- 局部 `tags`；
- `semanticSourceHash`；
- 模型和时间等 provenance。

跨文件业务结论、领域流程和回答文本不写入语义缓存。跨文件结论可以在当次回答中基于证据生成，但不写回为长期事实。

**为什么按需补充不产生重复数据**。缓存的最小单位是**节点自身**（按节点 ID + source hash 去重），不是"路径"或"流程"，所以根本不存在"B→C"这样一条可被重复写入的记录：

- **A→B→C，先问 B→C 再问 A→C**：问 B→C 时缓存 `summary(B)`、`summary(C)`；再问 A→C 时 B、C 按 ID 命中且 hash 未变 → 直接复用，只新算 `summary(A)`。A→B、B→C 这些边是**确定性事实**，由 Fact Builder 去重后写在 `knowledge-graph.json`，chat 只读不写。流程级理解（"A→B→C 合起来做了什么"）**按设计不落缓存**，每次基于事实边 + 节点摘要 + 源码证据重新推理——这是重算，不是重复存储；节点摘要（真正贵的逐文件读取）已被复用。需要流程级复用请走 Domain overlay（§7.5），它按 sourceRevision + factDigest 显式产出并去重。
- **两个 session 并发问 B→C**：两边都会**各自计算** `summary(B)`（重复的是算力 / token，不是数据）；写入时按 §8 的锁串行化，第二个 session 重读后对同一 node ID 做**幂等 upsert**（覆盖为等价值），不追加第二条。锁只协调"写"、不协调"生成"——即接受偶发重复计算，换取无需跨 session 的生成锁（生成锁会让一个 session 阻塞等另一个，且持有者崩溃会卡死）。

### 7.4 语义新鲜度

不增加显式状态机。字段有效性由 hash 直接判断：

- `semanticSourceHash == source manifest 中的当前 content hash`：可复用；
- `semanticSourceHash` 缺失：未补充；
- 两者不相等：过期，立即忽略。

Git 项目的工作区修改不会改变 HEAD manifest，因此不会让缓存抖动。DirectorySnapshot 的文件变化会产生新 revision，并使对应缓存失效。

### 7.5 Domain overlay

`domain-graph.json` 继续由显式 Domain 分析产生，并记录 `sourceRevision` 与 `factDigest`。Chat 只读取与当前事实层一致的 Domain 数据；其中的 domain、flow、step 是语义提示，回答业务流程时仍需用 fact graph 和源码证据核对。

## 8. 缓存并发与持久化

语义缓存写入必须在返回最终回答前尝试完成，但缓存失败不得阻塞回答。`knowledge-graph.json` 不参与这次写入。

最小安全写入协议：

1. Chat 和 Full 共用同一个 `.excavator/semantic.lock`，只在提交语义产物时短暂持有。
2. 重新读取最新 source manifest、fact graph 和 semantic cache。
3. 比较目标节点当前 source hash 与生成摘要时使用的 hash。
4. hash 不同则放弃写入。
5. 只合并允许的语义字段，禁止写入或覆盖 canonical graph。
6. 写临时文件并原子 rename。
7. 释放锁。

原子 rename 只防止半文件，不能防止两个 Chat 相互覆盖，所以锁、重新加载和 hash compare-and-swap 三者都需要保留。

**锁的陈旧处理**。`.excavator/semantic.lock` 只在"提交语义产物"这一步短暂持有（毫秒级，不覆盖 LLM 生成），因此卡死概率低；但仍须防"持锁者崩溃"：锁文件写入 `{ pid, host, acquiredAt }`，获取时若锁已存在且 `acquiredAt` 超过 TTL（例如 30s，远大于一次提交耗时）即视为陈旧并夺锁；夺锁与随后的 compare-and-swap（第 3 步）叠加，保证即便误夺也不会覆盖更新的 hash。重申锁只协调写、不协调生成：并发 session 可能重复计算同一节点摘要（可接受的 token 浪费），但存储侧因按 node ID upsert + CAS 而始终无重复、无丢更新。

## 9. Full 模式如何复用同一机制

Full 不再让 LLM 重新创造整张结构图：

1. 先运行与 Lazy 完全相同的事实构建或增量同步。
2. 根据 source hash 找出语义缺失或过期的文件。
3. `compute-batches` 只为这些文件生成 LLM 批次。
4. File Analyzer 输出局部语义补丁，只写 `semantic-cache.json`。
5. Architecture Analyzer 和 Assemble Reviewer 输出写入 `semantic-graph.json`，并记录 factDigest、证据和模型 provenance。
6. LLM 不得修改 canonical ID、源码范围、确定性结构边、coverage 或 gaps。
7. 无法映射到事实节点的模型输出记录为 semantic gap，不得创建假锚点。
8. `semantic-graph.json` 以 factDigest 为新鲜度键；事实未变化时允许复用。
9. Summary Verifier 保留在 Full 流程中，验证 semantic cache 和 semantic graph，不进入 Lazy 关键路径。

Full 不以逐字保持旧图里所有 module / concept 节点数量为兼容目标，但必须保持核心 file / function / class 的摘要、标签和 layers 能力。

`analysisMode` 控制显式 `/excavator` 的分析深度。Chat 无论配置为何都先快速同步事实；它不会因为配置为 `full` 就在一次问答前自动重跑全项目 LLM。需要全量刷新语义时，用户显式运行 `/excavator`。

## 10. Worktree 隔离

每个 worktree 使用自身的 `.excavator/`：

- 不重定向到主 checkout；
- 不共享可写缓存；
- 图谱只对应该 worktree 解析出的 SourceSnapshot revision；
- worktree 删除时允许缓存一起丢失。

这会牺牲少量缓存复用，但能避免不同分支覆盖同一图谱。

**与 v2 现状冲突，需显式改 skill**：当前 `skills/excavator/SKILL.md` Phase 0 的做法**相反**——检测到 worktree 时把输出**重定向到主 checkout**，注释引用 issue #133：Claude Code 的 worktree 是临时的，写在其中的 `.excavator/` 会随 session 销毁而丢图。§10 翻转为 per-worktree 是为快照正确性（图只对应该 worktree 的 revision、避免跨分支互相覆盖）做的主动取舍，但它**重新打开了 #133 的丢数据风险**。落地时必须：删掉 Phase 0 的 worktree 重定向逻辑；并明确提示"worktree 删除即缓存丢失"（§10 已声明容忍）。不得让两处默默矛盾。

## 11. 实施顺序与工时

每一步按仓库规则建立 OpenSpec change、先写失败验收、实现、验证，再单独 commit。**按薄垂直切片交付**：每个切片独立可测、独立可用，避免把"能用"吊在一个大步骤之后。

| 切片 | 内容 | 独立价值 / 验收 | 预计工时 |
|---|---|---|---:|
| A | 节点身份契约（§4.1，去重支柱，最先落）+ Lazy 首次运行（事实层 = `structure-all` + import-map 的投影）+ 只答**结构类**问题的 chat | 立刻消除 >1h 首跑；身份夹具 + go-clean-arch 首跑 <60s + 结构问答（§7 结构路径）全绿 | 10–16 小时 |
| B | SourceSnapshot 契约与三种 adapter（Git / Multi-repo / Directory）+ revision 增量同步（复用 `prepare-incremental.mjs`）+ 快照一致性 guard | 增量、非 Git、多仓的首建与同步（§12.2）全绿；factDigest 跨 adapter 一致（§12.4.1） | 10–14 小时 |
| C | 检索引擎：`source-index.jsonl`（symbol-aware BM25）+ 查询扩展 + 有预算多跳遍历 + 按需语义 + 并发缓存（锁 + CAS + 陈旧处理）| 中文问题命中英文代码（§12.3.1）+ 多跳路径（§12.3.2）+ 并发无丢更新（§12.4.5） | 14–20 小时 |
| D | Full 语义物理隔离 + Domain 新鲜度 + 所有消费 skill（chat / diff / explain / onboard / domain / 自动更新 hook）迁移到 sourceRevision | Full 与 Lazy 事实投影一致且不改 canonical graph（§12.5）+ 消费端一致（§12.6） | 10–14 小时 |
| E | 端到端验收、性能记录、文档、清理 Phase 0 的 worktree 重定向（§10）| §13 完成定义全过 | 5–8 小时 |

总计：49–72 小时。原 34–48 小时估计偏乐观：切片 C（检索引擎）是从零建持久化 BM25 索引 + 多跳遍历 + 并发缓存，接近"另一个产品"，故单独拆出并上调；身份契约提前进 A 作为一切去重的前置。

**排序理由**：身份契约必须最先落（B/C/D 的去重都依赖它）；先交付 A 拿到"首跑变快"的即时价值并验证事实层；再做 B 证明快照与增量可靠；C 是最大不确定性——**其中中文→英文召回（§12.3.1）必须在建全量索引前，先用一小组 gold 原型验证"无 embedding、只靠 BM25 + 查询扩展"这条路走不走得通**，走不通就在 C 内改用向量召回，不要把这个赌注埋到最后；D / E 收尾。切片内部顺序不可交换：先统一快照语义与事实层，再让 Chat 自动调用，最后迁移 Full 与其他消费端。

## 12. 最小验收标准

### 12.1 快速路径

1. Lazy 首次运行的 analyzer / verifier / architecture subagent 调用数为 0。
2. Lazy 不生成 LLM batch、HTML 或 Tour。
3. 固定性能 fixture 为 `https://github.com/bxcodec/go-clean-arch@e06c6d0cb37069b0ef56e3df67f80ca130a1ab82`；当前扫描清单为 36 文件、2,606 行。
4. 分别记录 snapshot、scan、import-map、parse、graph-build、source-index、validate、save 和总耗时；总耗时目标不超过 60 秒。

### 12.2 快照与更新

1. 同一 HEAD 下加入 staged、unstaged、untracked 变化，事实图、语义 hash 和源码回答不变。
2. Multi-repo revision 由成员路径和成员 HEAD 决定，成员工作区变化不进入结果。
3. DirectorySnapshot 的新增、修改、删除会改变 revision，并在下一次 Chat 前自动同步。
4. DirectorySnapshot 在分析期间持续变化时重试一次；仍变化则保留旧图并明确失败。
5. Excavator 不为非 Git 目录创建 `.git`。
6. Git 提交的新增、修改、删除、重命名和 revert 能在下一次 Chat 前自动同步。
7. 函数体调用变化和前面插入代码行后，calls 与 line range 正确更新。
8. 解析失败产生可见 gap，不把旧节点误删后假装成功。
9. Lazy 不得静默触发 Full。

### 12.3 检索

1. 中文业务问题面对英文代码时，查询扩展和 BM25 的 top-20 seeds 必须包含人工标注的目标文件或符号。
2. Controller → Service → Handler → EventBus 等多跳 fixture 能在预算内返回完整确定性路径。
3. 达到节点、边或 token 预算时停止扩展并报告覆盖边界。
4. semantic cache 和 Domain 命中必须回到 fact graph 或源码证据验证后才能进入答案。
5. 结构问题不触发语义补充。

### 12.4 一致性与缓存

1. 同一源码内容经 GitCommitSnapshot 或 DirectorySnapshot 分析时，确定性事实投影及 factDigest 完全一致。
2. Chat 或 Full 写入语义后，`knowledge-graph.json` 的 SHA-256 不变。
3. 可靠的局部语义问题会写入 `semantic-cache.json`，第二次可复用。
4. 文件 source hash 变化后对应语义立即失效。
5. 两个并发 Chat 不丢更新；旧 hash 的写入被拒绝。
6. worktree 不写入主 checkout 的图谱。

### 12.5 Full 与 Domain

1. Full 能在独立语义产物中生成文件和核心符号的 summary、tags、layers。
2. Full 的 LLM 输出不能修改确定性节点身份和结构边。
3. Full 只处理语义缺失或过期的文件，factDigest 未变化时不重做 Architecture。
4. Domain 产物记录 sourceRevision 与 factDigest；过期 Domain 不参与 Chat。

### 12.6 消费端一致性

1. Chat、Diff、Explain、Onboard、Domain 和自动更新 hook 都使用 sourceRevision 判断新鲜度。
2. Git 消费端通过 GitCommitSnapshot 读取源码，不泄漏工作区变化。
3. Directory 消费端通过 DirectorySnapshot 读取源码，并执行 content hash guard。

## 13. 完成定义

满足以下条件后 Lazy 模式才算完成：

- 上述最小验收全部通过；
- `pnpm -r build`、`pnpm test`、typecheck 和引用完整性检查通过；
- 对固定的 `go-clean-arch` commit 记录首次 Lazy、第二次 Chat、提交后首次 Chat、缓存命中 Chat 的详细耗时；
- 对 Git、多仓和非 Git directory fixture 分别验证首次构建与增量同步；
- 对同一源码快照跑一次 Full，证明 Full 与 Lazy 的事实投影一致且语义写入不改变 canonical graph；
- 文档记录实际性能和已知遗漏，不用“越问越快”替代实测数据。
