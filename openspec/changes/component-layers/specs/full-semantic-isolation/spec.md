## ADDED Requirements

### Requirement: 模型分层按确定性层审计

Phase F3 交给架构分析的事实节点 SHALL 带上节点的 `layer`（节点有时），并写明这是事实：有 `layer` 的节点与它所在的文件放进这一层。

`semantic-graph.mjs write` SHALL 在净化之后，按事实图审计模型的分层，只记缺口，MUST NOT 改写模型的分层：
- 有 `layer` 的类节点 L：它出现在 id 不是 L 的层里，记 `layer-role-mismatch`；
- 文件的确定性层：该文件里有 `layer` 的类节点都是同一层 L 时，文件的确定性层为 L；分属不同层时没有，不审计文件；
- 有确定性层 L 的文件节点出现在 id 不是 L 的层里，记 `layer-role-mismatch`；
- 有确定性层的文件节点与它里面有 `layer` 的类节点都不在任何层里，记 `layer-role-unplaced`。

缺口的样本写明节点 id、确定性层与实际放进的层。

#### Scenario: 放对了不记缺口
- **WHEN** 模型把 `OrderProcessorBean.java` 的文件节点放进 `layer:service`
- **THEN** 不记 `layer-role-` 缺口

#### Scenario: 放错了记缺口但不改写
- **WHEN** 模型把 `OrderProcessorBean.java` 的文件节点放进 `layer:ui`
- **THEN** 记一条 `layer-role-mismatch`，样本写明确定性层 `layer:service` 与实际层 `layer:ui`；写出的 `semantic-graph.json` 里该节点仍在 `layer:ui`

#### Scenario: 没有放进任何层
- **WHEN** 模型的分层里既没有 `Order.java` 的文件节点，也没有 `Order` 的类节点
- **THEN** 记一条 `layer-role-unplaced`
