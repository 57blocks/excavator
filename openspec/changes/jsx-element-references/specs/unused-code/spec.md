## MODIFIED Requirements

### Requirement: 产物、新鲜度与查询

`report` SHALL 写 `.excavator/unused-code.json`，内容包括：
- 头部：事实摘要、决定摘要、各状态与各可信度计数、残余假设；按语言的候选数、`calls` 边数与各可信度计数，候选集里的每种语言一行；
- 全部决定，每条带种类、理由、查询与命中数；
- 全部未使用候选，每条带原因、可信度、信号、直接引用者与所属组；
- 全部组，每组带入口与成员；
- `test-only` 节点。

头部 SHALL 写明残余假设：
- 未选中的文件不参与普查；
- 按运行时拼接的名字做的反射看不见；
- 构建时生成而不在仓库里的代码看不见；
- 仓库外的调用者只能体现在可见性上；
- 不写出方法名的使用看不见：视图、模板或 JSON 映射以属性名 `foo` 绑定 `getFoo` / `setFoo`，或其它按约定推出的名字；
- 事实图没能解析的调用与 JSX 元素没有边，事实图的缺口（`calls-unresolved`、`calls-ambiguous`、`calls-caller-unresolved`、`override-uncertain`，以及 `jsx-external`、`jsx-unbound`、`jsx-target-unresolved`、`jsx-ambiguous`、`jsx-caller-unresolved`）记录其数量；原因只陈述事实里有什么，这样被调用或被渲染的函数靠名字普查挡在 `high` 之外。

`report` SHALL 拒绝没有按语言 `calls` 计数的候选集，提示重新运行 `candidates`。`calls` 为 0 的语言，skill 的汇报与 chat 的回答 SHALL 说明事实里没有该语言的调用，它的节点被列为未使用不说明没有调用者。

skill 的汇报 SHALL：
- 把 `unreferenced` 说成事实里没有引用，MUST NOT 说成没有调用者；
- 只用产物里的字段解释计数。例如没有 `high` 的原因，取自 `medium` 节点的信号统计；
- 逐条列出产物的残余假设。

`report` SHALL 守恒：候选节点数 = 经决定移出的节点数 + `test-only` 节点数 + 未使用节点数。

`excavator-chat` SHALL 在用户问到未使用代码时读这个产物回答：
- 先比对事实摘要，不一致时说明产物已过期；
- 不把 `medium` 或 `low` 说成确定未使用；
- 产物缺失时告诉用户先运行 `excavator-unused-code`。

本能力的任何部分 MUST NOT 删除或修改项目代码。

#### Scenario: 事实变了
- **WHEN** 产物的事实摘要与当前事实图的摘要不同
- **THEN** chat 回答时说明产物已过期，需要重新运行

#### Scenario: 守恒
- **WHEN** 写产物时三类节点数之和不等于候选节点数
- **THEN** `report` 以非零状态退出，不写产物

#### Scenario: 没有 high 的原因
- **WHEN** 产物里没有 `high` 节点
- **THEN** skill 的汇报按 `medium` 节点的信号统计说明它们为什么不是 `high`，不用产物里没有统计的原因

#### Scenario: 残余假设列出 JSX 缺口
- **WHEN** `report` 写出产物
- **THEN** 残余假设里关于未解析引用的一条同时列出调用缺口与五个 JSX 缺口种类
