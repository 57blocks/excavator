## MODIFIED Requirements

### Requirement: 可区分维度不坍缩

不同 receiver / class / owner 下的同名方法，以及签名不同的重载，SHALL 得到不同的 ID。系统 MUST NOT 把不同 owner 下的同名方法合并为一个节点。对按参数类型区分重载的语言（Java），签名 SHALL 由参数类型组成，MUST NOT 只由参数名组成。

#### Scenario: 同名不同 receiver 的方法 → 两个 ID
- **WHEN** 同一文件内有两个不同 receiver/class 下同名的方法
- **THEN** 它们是两个不同的节点 ID

#### Scenario: 参数名相同、类型不同的 Java 重载 → 两个 ID
- **WHEN** 同一个 Java 类里有两个同名方法，参数名相同而参数类型不同（例如 `update(JsonCommand command)` 与 `update(Map command)`）
- **THEN** 它们是两个不同的节点 ID，且不产生 identity-collision

#### Scenario: 不同顶层类型下的同名 Java 方法 → 两个 ID
- **WHEN** 同一个 Java 文件里两个顶层类型各有一个同名同参数类型的方法
- **THEN** 它们的 ID 带有各自的所属类型，是两个不同的节点 ID
