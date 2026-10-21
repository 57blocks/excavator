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
- 事实图没能解析的调用与 JSX 元素没有边，事实图的缺口（`calls-unresolved`、`calls-ambiguous`、`calls-caller-unresolved`、`override-uncertain`，以及 `jsx-external`、`jsx-unbound`、`jsx-target-unresolved`、`jsx-ambiguous`、`jsx-caller-unresolved`）记录其数量；TS/JS 里作为值传递的函数（路由表或属性里的组件、回调、`lazy(() => import(...))`）也没有边；原因只陈述事实里有什么，这样以这些方式被使用的函数靠名字普查挡在 `high` 之外。

`report` SHALL 拒绝没有按语言 `calls` 计数的候选集，提示重新运行 `candidates`。`calls` 为 0 的语言，skill 的汇报与 chat 的回答 SHALL 说明事实里没有该语言的调用，它的节点被列为未使用不说明没有调用者。

skill 的汇报 SHALL：
- 把 `unreferenced` 说成事实里没有引用，MUST NOT 说成没有调用者；
- 只用产物里的字段解释计数。例如没有 `high` 的原因，取自 `medium` 节点的信号统计；
- 逐条列出产物的残余假设；
- 汇报就是最后的回复：以计数开头，以指向 `/excavator-chat` 的固定一句结尾，之前、之后都不写别的，MUST NOT 加自己的摘要或结论；项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）MUST NOT 改变它的顺序与首尾；
- 运行中写给用户的每一句话（命令之间的进度说明，以及关于查了什么、下一步做什么、依据哪条规则的说明在内）、入口决定的理由与汇报 SHALL 用 `--language` 指定的语言，没有指定时用英文。只有 `--language` 改变它：项目文件（如 `CLAUDE.md`、`AGENTS.md` 里的回复语言要求）、记忆与系统区域设置 MUST NOT 改变它；skill MUST NOT 说明用了哪种语言及原因。skill 给定的固定措辞，换了语言时译成那种语言；路径、id、命令与产物里的值保持原样。

`report` SHALL 守恒：候选节点数 = 经决定移出的节点数 + `test-only` 节点数 + 未使用节点数。

`excavator-chat` SHALL 在用户问到未使用代码时读这个产物回答：
- 先比对事实摘要，不一致时说明产物已过期；
- 不把 `medium` 或 `low` 说成确定未使用；
- 产物缺失时告诉用户先运行 `excavator-unused-code`。

本能力的任何部分 MUST NOT 删除或修改项目代码。

#### Scenario: 项目文件要求用中文回复、先说结论
- **WHEN** 项目的 `AGENTS.md` 写着用中文回复、先说结论与验证结果，调用时没有 `--language`
- **THEN** 运行中每段写给用户的话、入口决定的理由与汇报都是英文，也不说明为什么用英文；汇报以计数开头、以指向 `/excavator-chat` 的那句结尾，没有「结论」一节，也没有产物之外的解释

#### Scenario: 指定了语言
- **WHEN** 调用时给了 `--language` 指定另一种语言
- **THEN** 汇报用那种语言，skill 给定的固定措辞译成那种语言，路径、id 与产物里的值保持原样，顺序与首尾不变

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
- **THEN** 残余假设里关于未解析引用的一条同时列出调用缺口与五个 JSX 缺口种类，并说明 TS/JS 里作为值传递的函数没有边
