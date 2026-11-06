## MODIFIED Requirements

### Requirement: 手册的部分

手册 SHALL 由几个部分组成，每个部分可以单独选择：
- `overview`：系统概览；
- `features`：功能条目；
- `data`：数据；
- `findings`：功能的发现；
- `system-findings`：系统的发现。

`--sections <list>` 选择这次运行的部分，不给时为全部。

每个部分的阶段文字 SHALL 放在 skill 目录下它自己的文件里，只在选中时读。地图阶段 SHALL 放在一个阶段文件里，只要选了依赖它的部分（概览、功能、发现、系统的发现）就读一次。数据部分 SHALL NOT 依赖地图。要读哪些文件、按什么顺序，SHALL 由 `handbook.mjs sections` 按固定的依赖表打印，不由模型推断。

没选的部分的阶段 SHALL NOT 运行。第 5、6 阶段 SHALL 只处理所选部分的单元。

拼装 SHALL 不受 `--sections` 影响：输出目录里已有的都拼进去，没写的部分照旧有可见的说明。

#### Scenario: 只写概览
- **WHEN** 以 `--sections overview` 运行
- **THEN** 地图与概览照常写、核对与追查，不派发任何功能条目、发现或系统发现的子代理，也不读功能、数据、发现与系统发现部分的文件

#### Scenario: 非法的部分名
- **WHEN** `--sections tables,overview` 中有一个不认识的值
- **THEN** `handbook.mjs sections` 退出 1，并打印可选值

#### Scenario: 默认运行
- **WHEN** 不给 `--sections`
- **THEN** 读地图、概览、功能、数据、发现与系统发现六个文件；地图、概览、功能与发现的文字与改前逐字相同

#### Scenario: 只写数据
- **WHEN** 以 `--sections data` 运行
- **THEN** 只读数据部分的文件，不读地图文件，不派发任何子代理

#### Scenario: 只写发现
- **WHEN** 以 `--sections findings` 运行
- **THEN** 读地图文件与发现部分的文件，只派发发现的子代理及其核对者与追查者；已有的条目与概览不变

#### Scenario: 只写系统的发现
- **WHEN** 以 `--sections system-findings` 运行
- **THEN** 读地图文件与系统发现部分的文件，只派发系统发现的子代理及其核对者与追查者；已有的条目、概览与功能的发现不变

## ADDED Requirements

### Requirement: 系统的发现

每个应用根 SHALL 有一个系统发现单元，id 是 `app<n>.system`，`n` 是应用根排序后的序号，由一个子代理写。它的种子文件 SHALL 由脚本确定：该应用根里有启动入口或定时任务候选的文件，以及登记了至少 5 个入口候选的文件。子代理从种子出发，按发现子代理同样的界限读代码，写出这个应用里不属于任何单个功能的缺陷。

系统发现 SHALL 与功能的发现形状相同、经过同样的脚本检查、核对与追查，另外 SHALL 经过两道检查：
- 每条至少有一段引文在这个应用根之下；
- 引用的文件全都是同一个功能的种子文件、而且没有一个是这个单元的种子时，拒绝。

`--applications <list>` SHALL 只为所列的应用根写系统发现；不给时为全部。

#### Scenario: 属于一个功能的发现
- **WHEN** 一条系统发现只引用了功能 F8 的种子文件
- **THEN** `check-system-findings` 退出 1，并写出 F8

#### Scenario: 没有种子
- **WHEN** 一个应用根里没有启动入口、定时任务，也没有登记了至少 5 个候选的文件
- **THEN** 这个单元直接记为已核实，没有发现，不派发子代理

#### Scenario: 不认识的应用根
- **WHEN** `--applications` 里有一个不是应用根的目录
- **THEN** `handbook.mjs` 退出 1，并列出全部应用根

#### Scenario: 旧的输出目录
- **WHEN** 续跑一个 `state.json` 没有 `systemFindings` 键的输出目录
- **THEN** 每个系统发现单元都是 `planned`、没有尝试，不需要迁移

### Requirement: 同一处缺陷

拼装与页面 SHALL 把已核实的发现（功能的与系统的）分组：两条发现类别相同，并且各有一段引文在同一个文件里行号重叠，就在同一组；分组可以传递。

一组 SHALL 只算一条，写出第一条的陈述与所有归属；组里其它陈述 SHALL 照写在它下面，前面写它的归属。计数行 SHALL 写出合并了几组。

#### Scenario: 两个功能写了同一处
- **WHEN** F1 与 F8 各有一条已核实的发现，类别都是交互和显示缺陷，引文都包括同一个文件的第 276 行
- **THEN** 「发现」一章里它们是一条，归属写 F1 与 F8，F8 的陈述写在下面；计数行写出合并了 1 组

#### Scenario: 类别不同
- **WHEN** 两条发现引文重叠，类别不同
- **THEN** 它们各算一条
