## ADDED Requirements

### Requirement: 整本手册一种写法

由模型写的每一部分（系统概览、每个功能的问题、每个应用的系统问题、问题排序、对策、专题）SHALL 写一次，由脚本检查，检查通过记为 `checked`，`checked` 是终态。技能 SHALL NOT 为它们派核对者、追查者或评判者。

#### Scenario: 问题写完就进手册

- **WHEN** 一个功能的问题文件通过 `check-findings`
- **THEN** 它记为 `checked`，拼装出的手册里有这些问题，开头有一句固定文字说明未经核对

#### Scenario: 专题不等评判

- **WHEN** 一个专题通道的文件通过检查
- **THEN** 通道记为 `checked`，`topic-facts` 报这个通道已完成，手册里有它的行并标为未核对

### Requirement: 未核对内容的标记

手册里每一块来自 `checked` 内容的输出 SHALL 带一句固定文字，说明它由模型依据代码写成、未经核对；来自旧运行里已确认内容的输出 SHALL NOT 带这句。覆盖一节 SHALL 按「已写、未核对」计数这些内容，SHALL NOT 把它们算作未完成。

#### Scenario: 全部未核对的运行

- **WHEN** 输出目录里概览、问题、系统问题、排序、对策、专题都是 `checked`，没有一个已确认
- **THEN** 手册与页面里每一块都在，各带自己的未核对文字，没有一块写成未完成
