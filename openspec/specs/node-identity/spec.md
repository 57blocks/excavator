# node-identity Specification

## Purpose

定义确定性的节点身份，使同一逻辑节点在任何运行与任何 SourceSnapshot adapter 下都得到同一个 ID。节点身份是后续按需语义缓存去重的唯一支点：ID 不稳定就会出现一个节点两条缓存、以及"有事实节点却无对应语义"的悬挂。

## Requirements

### Requirement: 单一确定性 node-id 函数

系统 SHALL 通过**一处实现**的确定性函数派生每个事实节点的 ID，且 Fact Builder 与 Chat 的缓存查找两侧 MUST 共用同一函数，不得各自实现。ID 优先由 `path + kind + owner + normalized signature` 派生。

#### Scenario: 同源码重复运行得到相同 ID
- **WHEN** 对同一源码内容重复运行事实构建
- **THEN** 每个节点得到逐字节相同的 ID

#### Scenario: 两侧共用同一函数
- **WHEN** Fact Builder 为节点 X 生成 ID，且 Chat 为同一声明查缓存
- **THEN** 两者经同一函数得到相同 ID

### Requirement: 跨 adapter 路径稳定

同一逻辑文件无论经 git 相对路径、普通目录相对路径，还是多仓成员前缀路径分析，规范化后 SHALL 得到同一 path 分量，从而得到同一 ID。多仓成员前缀 SHALL 采用固定规则 `<memberId>/<member-relative-path>`。

#### Scenario: 等价路径表示派生同一 ID
- **WHEN** 同一文件以 git 相对路径、`./` 前缀、windows 分隔符等等价表示出现（不同 adapter 的等价读法）
- **THEN** 它们派生出同一节点 ID

#### Scenario: 多仓成员前缀稳定且区分成员
- **WHEN** 同一相对路径的文件分别位于多仓成员 m1 与 m2
- **THEN** 成员前缀 `<memberId>/…` 稳定，且 m1 与 m2 下的文件得到不同 ID

### Requirement: 可区分维度不坍缩

不同 receiver / class / owner 下的同名方法，以及签名不同的重载，SHALL 得到不同的 ID。系统 MUST NOT 把不同 owner 下的同名方法合并为一个节点。

#### Scenario: 同名不同 receiver 的方法 → 两个 ID
- **WHEN** 同一文件内有两个不同 receiver/class 下同名的方法
- **THEN** 它们是两个不同的节点 ID

### Requirement: 匿名与难命名构造的稳定兜底

对没有稳定 name/signature 的节点（匿名函数、箭头常量、默认导出的匿名 handler、闭包内声明等），系统 SHALL 按顺序兜底：`path+kind+owner+signature` → `path+kind+owner+name` → owner 内同 kind 声明的**出现序号**。使用序号兜底时 MUST 将其记入 provenance。在该节点之前插入注释、空行或非同类代码 SHALL NOT 改变其 ID；在其之前新增一个同类声明 MAY 改变其 ID，但该变化只表现为该节点自身缓存失效重算，MUST NOT 错配到其他节点。

#### Scenario: 前插非声明代码 → ID 不变
- **WHEN** 在一个匿名 handler 之前插入注释、空行或非同类声明
- **THEN** 该 handler 的节点 ID 不变

#### Scenario: 前插同类声明 → ID 可变但不张冠李戴
- **WHEN** 在该匿名 handler 之前新增一个同 kind 的声明
- **THEN** 该 handler 的 ID 允许变化，但仅导致其自身缓存失效，绝不把旧缓存错配到其他节点

### Requirement: 身份一致性可见，冲突不静默

每个语义/缓存条目引用的 node-id SHALL 恰好对应一个事实节点；两个可区分的声明派生出同一个 ID（身份冲突）SHALL 作为可见错误报告，MUST NOT 被静默合并为一行。

#### Scenario: 身份冲突被报告
- **WHEN** 两个可区分声明经 node-id 函数得到相同 ID
- **THEN** 系统报告一条 identity-collision，而不是静默合并这两个节点
