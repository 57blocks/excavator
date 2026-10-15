## ADDED Requirements

### Requirement: EL 到方法由附录推断

`frameworks/jsf.md` SHALL 给出从页面到 bean 方法的推断规则。规则只用已有的事实，不新增确定性阶段：
- 从页面到 bean 类的 `references` 边，证据里记下了 EL 链；
- 取根名之后的第一个成员，如 `orders.detail` 的 `detail`、`orders.list` 的 `list`；
- 动作方法与属性用同一条规则：成员 `m` 对应名为 `m`、`getM` 或 `isM` 的方法。证据不记 EL 写在哪个属性里，所以不区分方法表达式与值表达式。

候选集是 bean 类所在文件里、`owner` 为该类、名字是上面三者之一的方法节点。只用节点名与 `owner` 比对，不读源码。恰好一个时，从页面画一条 `inferred` 的 `depends_on` 边到它，不带 `evidence`。以下情形不连：
- 零个：成员在仓库外的父类里，或由 Lombok 等生成；
- 多个：方法重载；
- 根名之后的成员不止一层（`#{orders.selected.name}`）：第二层以后的类型由运行时决定，只解析第一层。

#### Scenario: 动作方法唯一
- **WHEN** `list.xhtml` 写 `action="#{orders.detail}"`，`references` 边连到 `OrderBean`，`OrderBean` 里恰好一个名叫 `detail` 的方法
- **THEN** 附录指示从 `list.xhtml` 画一条 `inferred` 的 `depends_on` 边到 `OrderBean.detail`

#### Scenario: 重载不连
- **WHEN** bean 类里有两个名叫 `detail` 的方法
- **THEN** 附录指示不连
