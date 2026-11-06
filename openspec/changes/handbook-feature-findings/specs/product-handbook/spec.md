## MODIFIED Requirements

### Requirement: 手册的部分

手册 SHALL 由几个部分组成，每个部分可以单独选择：
- `overview`：系统概览；
- `features`：功能条目；
- `data`：数据；
- `findings`：功能的发现。

`--sections <list>` 选择这次运行的部分，不给时为全部。

每个部分的阶段文字 SHALL 放在 skill 目录下它自己的文件里，只在选中时读。地图阶段 SHALL 放在一个阶段文件里，只要选了依赖它的部分（概览、功能、发现）就读一次。数据部分 SHALL NOT 依赖地图。要读哪些文件、按什么顺序，SHALL 由 `handbook.mjs sections` 按固定的依赖表打印，不由模型推断。

没选的部分的阶段 SHALL NOT 运行。第 5、6 阶段 SHALL 只处理所选部分的单元。

拼装 SHALL 不受 `--sections` 影响：输出目录里已有的都拼进去，没写的部分照旧有可见的说明。

#### Scenario: 只写概览
- **WHEN** 以 `--sections overview` 运行
- **THEN** 地图与概览照常写、核对与追查，不派发任何功能条目或发现的子代理，也不读功能、数据与发现部分的文件

#### Scenario: 非法的部分名
- **WHEN** `--sections tables,overview` 中有一个不认识的值
- **THEN** `handbook.mjs sections` 退出 1，并打印可选值

#### Scenario: 默认运行
- **WHEN** 不给 `--sections`
- **THEN** 读地图、概览、功能、数据与发现五个文件；地图、概览与功能的文字与改前逐字相同

#### Scenario: 只写数据
- **WHEN** 以 `--sections data` 运行
- **THEN** 只读数据部分的文件，不读地图文件，不派发任何子代理

#### Scenario: 只写发现
- **WHEN** 以 `--sections findings` 运行
- **THEN** 读地图文件与发现部分的文件，只派发发现的子代理及其核对者与追查者；已有的条目与概览不变

## ADDED Requirements

### Requirement: 功能的发现

每个功能 SHALL 有一个发现单元，id 是 `<功能 id>.findings`，由一个子代理写。它从该功能的种子文件出发，按条目子代理同样的界限读代码，写出代码今天表现出来的缺陷。每条发现 SHALL 有：
- 固定枚举里的一个类别；
- 一段陈述：缺陷是什么、在什么情况下发生；
- 引文。

发现 SHALL NOT 写怎么改，也 SHALL NOT 评价。可以一条也没有。

发现单元 SHALL 经过条目的全部脚本检查，外加一道建议词检查。然后 SHALL 与条目一样经过两名核对者、一次只换引文的改写与两名追查者，未被证明或被反驳的发现删除并记录理由。没有发现的单元 SHALL 直接记为已核实。

手册 SHALL 只写已核实的发现单元：
- 两个视图都有「发现」一章，按类别分组并计数；
- 技术视图写出每条的文件与行号，产品视图 SHALL NOT 写；
- 功能一节与功能页列出它自己的发现；
- 覆盖一节列出删掉的发现与未核实完的单元。

手册的其它部分 SHALL 仍只陈述现状。

#### Scenario: 一条发现走完核对
- **WHEN** 一个发现单元有两条发现，核对者都确认，追查者找到第二条的反证
- **THEN** 手册只写第一条，覆盖一节列出第二条与追查者的理由

#### Scenario: 没有发现
- **WHEN** 发现子代理写了空列表
- **THEN** `check-findings` 把单元记为已核实，第 5、6 阶段不列出它，手册里这个功能没有发现

#### Scenario: 建议词
- **WHEN** 一条发现的陈述里有建议词表里的词
- **THEN** `check-findings` 退出 1，并写出那个词

#### Scenario: 条目没核实
- **WHEN** 一个功能的条目失败了，它的发现单元已核实
- **THEN** 「发现」一章照样写出这些发现，带功能名

#### Scenario: 产品视图不写路径
- **WHEN** 以产品视图拼装
- **THEN** 「发现」一章有陈述与功能名，没有文件与行号

#### Scenario: 旧的输出目录
- **WHEN** 续跑一个 `state.json` 没有 `findings` 键的输出目录
- **THEN** 每个发现单元都是 `planned`、没有尝试，不需要迁移
