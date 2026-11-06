## Why

数据部分已经有表、迁移与表名出现的位置，还缺状态字典：系统里各业务对象有哪些状态值、类型值，每个值叫什么、代表什么。重构时要逐个对齐这些值，前后端各写一份时还要知道两边是否一致。

值与它们的位置是结构化的代码事实，必须由脚本确定性地抽取。含义同理，不让模型写，只取代码里已有的两种文字：
- 紧挨着值的注释原文；
- 把值映射到显示名的映射表。

## What Changes

- `handbook.mjs data` 另写 `$OUT/dictionaries.json`，与 `data.json` 并列。计数行加一段字典的计数。
- 认得的值集合（design D2）：
  - Go：以基本类型（`string`、整数）声明的具名类型，加上同一个包里以它为类型的常量。`iota` 的值按规则算出，算不出的照原样写出并标明；
  - TypeScript：`enum` 与 `const enum`，按语言规则补齐自动递增的数值；
  - JavaScript：赋给名字以 Status、State、Type、Kind 等结尾的变量的对象字面量，取其中值为字面量的成员。
- 每个值带：
  - 名字、值、文件与行；
  - 紧挨着它的注释原文；
  - 映射表给出的显示名及其位置（design D3）。
- 同名的值集合出现在不止一个应用、且值不同时，单列一张清单，逐项写出差异。
- 每个候选输入落进一个有名字的桶，没有静默丢弃（design D4）：
  - Go 的基本具名类型、带类型的常量、无类型的 `iota` 常量组；
  - TS 的枚举；
  - JS 的候选对象。
- 技术视图的手册在数据一章里加「状态字典」一节；页面加 `#/dictionaries` 页，可按应用筛选。产品视图不显示。固定文字走 `ui.json` 的新键。

**不做**：
- 模型写的含义；
- 按业务领域分组；
- 值在代码里被谁使用；
- Java、Python 等其它语言的枚举，以及 SQL 的 ENUM 列。页面写明这次认得哪些形式。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `product-handbook`：新增「状态字典」要求。

## Impact

- `skills/excavator-product-handbook/`：
  - 新模块 `lib/dict-*.mjs`；
  - `lib/data-run.mjs`：写出第二个文件、扩充计数行；
  - 渲染：数据一章里加一节；
  - `ui-strings.json` 新键；
  - `sections/data.md` 只在计数行的描述上有改动。
- `packages/product-handbook-page/`：页面数据加 `technical.dictionaries`，格式升到 `/7`；新路由、侧栏链接、字典页。
- 测试：
  - 新夹具与抽取、守恒测试；
  - 渲染与页面测试；
  - 合约测试的摘要更新。
