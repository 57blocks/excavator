## MODIFIED Requirements

### Requirement: 工具面按职责分离且有界

MCP surface SHALL 提供且仅提供以下项目级能力：`project_status` 报告当前数据与新鲜度；`sync_facts` 构建或刷新确定性事实；`recall` 返回有界候选；`traverse` 从明确 seeds 做有界图遍历；`read_evidence` 读取明确范围的当前源码或事实证据；`semantic_plan` 对明确 node id 集合建立复用计划；`semantic_commit` 提交调用方生成的节点局部语义；`dead_code` 只读地返回活性判定产物的普查、按判定过滤的分页列表，以及不超过 20 个明确 node id 的判定、原因与证据。`dead_code` MUST NOT 计算判定、MUST NOT 读取或写入活性声明文件；产物缺失或其事实摘要、声明摘要与当前不一致时 SHALL 返回 `missing-product` / `stale-product` 的可见终态，不返回旧判定。MCP surface MUST NOT 提供任意 shell、任意文件写入、无界图谱导出或 `answer_question` 类模型代理工具。

#### Scenario: 大范围问题分阶段探索
- **WHEN** 调用方要调查“当前项目的所有流程”等大范围问题
- **THEN** 调用方可多次组合 recall、traverse 与 read_evidence，并从每次响应的边界继续探索，而不是请求一次无界全图输出

#### Scenario: 未声明的执行能力被拒绝
- **WHEN** 客户端请求执行任意命令、写任意文件或让 server 直接回答问题
- **THEN** server 以结构化错误拒绝请求且不产生项目副作用

#### Scenario: 查询单个方法的活性判定
- **WHEN** 调用方以一个 node id 调用 `dead_code`
- **THEN** 返回该节点的判定（`live` / `test-only` / `undetermined` / `suspect` / `dead` 之一）；`live` 带根与可重建的路径，`undetermined` 带原因与证据位置，`suspect` 带原因与能了结它的声明，`dead` 带已执行检查与簇标识；结果绑定当前快照身份与产物摘要

#### Scenario: 判定产物过期
- **WHEN** 事实图已重建而判定产物仍由旧事实摘要构建
- **THEN** `dead_code` 返回 `stale-product`、两个摘要与重建提示，不返回旧判定
