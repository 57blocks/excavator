# full-semantic-isolation Specification

## Purpose

让 Full 模式与 Lazy 共用同一确定性事实构建，语义只写独立产物、绝不改 canonical 事实图，并只为语义缺失或过期的文件付 LLM。这样 Full 与 Lazy 事实投影一致、模型永不篡改身份/结构，且重复 Full 在事实未变时不重做架构分析。

## Requirements

### Requirement: Full 复用确定性事实构建

`/excavator --mode=full` SHALL 先执行与 Lazy 完全相同的 `scan → structure-all → build-fact-graph` 得到确定性事实图，MUST NOT 让 LLM 重新创造结构图。对同一源码，Full 与 Lazy SHALL 得到一致的事实投影与相同 `factDigest`。

#### Scenario: Full 与 Lazy 事实投影一致
- **WHEN** 对同一源码分别以 lazy 与 full 运行
- **THEN** 两者的确定性事实节点/边与 `factDigest` 一致（差异只在语义产物是否生成）

### Requirement: 语义物理隔离，事实图不可被 LLM 改

Full 生成的语义 SHALL 写入独立产物：节点局部 summary/tags 进 `semantic-cache.json`，架构/layers 进 `semantic-graph.json`。LLM 输出 MUST NOT 修改 `knowledge-graph.jsonl` 的节点身份、源码范围、确定性结构边、coverage 或 gaps——这些事实字段的内容在 Full 语义生成前后 SHALL 保持不变。

#### Scenario: Full 语义写入不改事实字段
- **WHEN** Full 生成并写入语义
- **THEN** `knowledge-graph.jsonl` 的事实字段（节点身份/源码范围/结构边/coverage/gaps）逐字不变；summary/layers 出现在独立的 `semantic-cache.json` / `semantic-graph.json`

### Requirement: 只处理缺失/过期语义，factDigest 为架构新鲜度键

Full SHALL 只为语义缺失或过期（按 source hash）的文件生成节点语义。`semantic-graph.json` SHALL 以 `factDigest` 为新鲜度键：当 `factDigest` 未变化时，Architecture SHALL NOT 重跑、已有 `semantic-graph.json` 可复用。

#### Scenario: factDigest 未变则跳过 Architecture
- **WHEN** 事实未变化（factDigest 相同）再次运行 Full
- **THEN** 已有 semantic-graph.json 被复用，Architecture 不重跑；只补齐仍缺失/过期的节点语义

### Requirement: 无法映射的模型输出记为 semantic gap

无法映射到任何事实节点的模型输出 SHALL 记录为 semantic gap，MUST NOT 创建假锚点或塞进事实图。

#### Scenario: 悬空语义记 gap
- **WHEN** 模型产出的某语义无法对应到任何 fact 节点
- **THEN** 记为一条 semantic gap，而不是新建事实锚点

### Requirement: Summary-Verifier 留在 Full

Summary-Verifier SHALL 在 Full 流程中核验语义产物（semantic-cache/semantic-graph），MUST NOT 进入 Lazy 关键路径。

#### Scenario: Full 核验语义、Lazy 不核验
- **WHEN** 运行 Full
- **THEN** Summary-Verifier 核验生成的语义并写回核验状态；Lazy 首跑不触发它

### Requirement: 架构分析拿到节点语义与页面引用

Phase F3 交给架构分析的输入 SHALL 包括：
- 每个事实节点的 `{id, type, name, filePath}`，节点有 `owner` 时加上 `owner`（方法所属的类）；
- 节点在 `semantic-cache.json` 里有新鲜条目时，它的 `tags`；文件级节点另带 `summary`；
- 事实图里的 `imports` 边，以及 `references` 边连同每条证据的 EL 链（`chain`）与行。

提示词 SHALL 写明：
- 标签是 Phase F2 读源码时写下的；来自附录「Canonical File Roles」的标签表示附录按注解、描述符条目或文件模式判定的角色；
- `references` 边说明哪些类被页面经 EL 绑定，EL 链给出页面用到的成员；F2 看不到这些边，页面绑定的角色只在边里；
- 分层按注入的框架附录的层表进行；附录按角色定层时，以标签与页面引用为准，不以名字、类名后缀、目录或模块为准。

派发 SHALL 全文注入框架附录，不删节、不改写；除模板与输入外不附加编排者自己的内容（Phase 4 的附加上下文、对模块或分层的结论）。

Phase F2 的派发 SHALL 给出本 skill 的目录，使文件分析从被运行的那份 skill 读附录；SHALL 要求：附录「Canonical File Roles」按源码可见的依据给节点指定角色时，节点的 `tags` 含该行 Tags 列的标签。

没有新鲜语义条目的节点不带 `tags` 与 `summary`，不补写、不猜测。

#### Scenario: 会话 bean 的角色进入分层输入
- **WHEN** F2 已为 `OrderProcessorBean.java` 写下带 `service` 标签的语义条目，然后运行 F3
- **THEN** 架构分析拿到的该文件节点带这组标签与摘要

#### Scenario: 页面绑定进入分层输入
- **WHEN** 事实图里有从 `list.xhtml` 到 `OrderBean` 的 `references` 边
- **THEN** 架构分析拿到的边里有这条 `references` 边

#### Scenario: 没有语义的节点不补写
- **WHEN** 某节点在 `semantic-cache.json` 里没有新鲜条目
- **THEN** 该节点在输入里只有 `{id, type, name, filePath}`（有 `owner` 时加上 `owner`）

#### Scenario: 附录角色标签由 F2 写下
- **WHEN** F2 读到一个带 `@Stateless` 的类，附录把它定为会话 bean，Tags 列为 `service`
- **THEN** F2 派发要求该类节点的 `tags` 含 `service`，与模型自选的标签并列
