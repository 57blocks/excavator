## Context

数据部分（`handbook-data-tables`）已有 `handbook.mjs data`。它用 `lib/data-files.mjs` 遍历项目、按 `lib/applications.mjs` 归属应用，在技术视图渲染数据一章与 `#/data` 页。core 只抽 Java 枚举的常量名，手册的脚本也不读 core 的事实。

验收语料 go-multirepo 的值集合有三种写法：
- Go：约 130 个以基本类型声明的具名类型，常量组里有 `iota`，类型与常量常不在同一个文件；
- 前端 TS：70 个 `enum`；
- 旧 Node 服务的 JS：形如 `const UserStatus = { active: 1, …, properties: { 1: 'active' } }` 的对象。

挨着值的注释很少，约 27 处。显示名映射表有三种：
- Go 的 `map[…]string{ X.Uint8(): "Active" }`，约 33 个；
- TS 的 `{ [Enum.A]: 'Label' }`，约 21 条；
- JS 对象内的反向表 `properties`。

## Goals / Non-Goals

**Goals**：
- 值集合、值、位置、注释与显示名，全部由脚本确定性产出；
- 前后端同名不同值的对照；
- 每个候选输入落进有名字的桶；
- 技术视图显示。

**Non-Goals**：
- 模型写的含义；
- 按领域分组；
- 值的使用位置；
- 其它语言与 SQL ENUM。

## Decisions

### D1 文件与命令

`handbook.mjs data` 在写 `data.json` 之后写 `dictionaries.json`，格式 `excavator-product-handbook-dictionaries/1`。两个文件各自做形状校验，各自有「没有」与「不合格」的说明。`data.json` 的格式不变。

`Data:` 那一行之后多打印一行 `Dictionaries: …`。`sections/data.md` 改为照抄两行。

### D2 认得的值集合

Go，按包（目录）处理：
- **类型**：`type T string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64`，也认别名写法 `type T = uint8`，单独声明或在 `type ( … )` 组里。
- **常量**：`const ( … )` 组与单独的 `const`。
  - 一项写了类型 `T`，且 `T` 是同一目录里声明的基本具名类型：属于值集合 `T`。
  - 只写名字的项：重复上一项的类型与表达式（Go 的隐式重复）。
  - `iota` 是该项在组里的序号，从 0 起。
- **值**：
  - 字符串、整数字面值照写；
  - 能算出的表达式：`iota`、`iota ± k`、`k + iota`、`iota * k`、`1 << iota`、`1 << (iota + k)`，按 Go 语义算出；
  - 其它表达式照原样写出，标 `computed: false`。

TypeScript：
- `[export] [const] enum E { … }`；
- 成员写了值时照写；没写值时，按语言规则取上一个数值成员加 1，第一个成员是 0。上一个成员是字符串或算不出的表达式时，这一项也算不出，照原样标明。

JavaScript（以及 TypeScript 文件里以 `as const` 结尾的对象）：
- 赋值给 `const|let|var X`、`module.exports.X`、`exports.X` 的对象字面量，且 `X` 匹配 `/(status|state|type|kind|stage|phase|level|role|mode|category)$/i`；
- 值集合是其中值为字符串或数字字面值的顶层成员；
- 其它顶层成员：
  - 反向表（键都是本集合的值、值都是字符串字面值的嵌套对象）按 D3 处理；
  - 其余计入该集合的 `skippedMembers`。

值集合的 `id` 是 `应用/文件:名字`。Go 的 `id` 用声明类型的文件。

### D3 含义：注释与显示名

**注释**：
- 同一行在值之后的 `//` 或 `/* … */`；
- 紧挨在成员上一行起、连续的 `//` 行，或一个 `/** … */` 或 `/* … */` 块，中间不许有空行。

去掉注释记号后原文照抄，多行用空格连接。

**显示名**：
- Go：同一应用里任意 `map[K]string{ … }` 字面值的条目。键是 `C`、`pkg.C`，或 `C.Method()`、`pkg.C.Method()`，`C` 是某个值集合的成员，值是字符串字面值。
- TS：对象字面值的条目，键是 `[E.M]` 或 `[E['M']]`，值是字符串字面值。
- JS：D2 的反向表。

显示名记下映射表条目的文件与行。一个成员有多个显示名时全部列出。

### D4 桶

| 输入 | 桶 |
|---|---|
| Go 基本具名类型 | `dictionary`（有常量）／`noConstants` |
| Go 常量项 | `member`／`untypedIota`（组里没有类型、用了 `iota`）／`otherType`（类型不是本目录的基本具名类型）／`plain`（无类型、不用 `iota`） |
| TS 枚举 | `dictionary` |
| JS 候选对象 | `dictionary`（至少一个字面值成员）／`noLiteralMembers` |
| 映射表条目 | `label`／`unmatchedKey`：键形似成员引用，却不对应任何成员 |

`counts` 只由脚本从清单算出。守恒测试逐类核对。

### D5 前后端对照

- 按名字（去掉应用与文件）分组，同名的值集合出现在两个以上应用时逐对比较。名字比较不分大小写，并忽略 `_`。
- 比较的是**值**，不比较成员名：各语言的成员命名习惯不同，例如 Go 常带类型前缀。
- 写出只在一边出现的值。两边都有的值，各自的成员名并列写出，供读者对照。
- 未计算的值不参与比较，单独写出「未比较」。
- 有差异的进 `mismatches[]`。

### D6 呈现

**手册**：数据一章里，在表之后加「状态字典」一节：
- 固定说明：认得的形式；含义只来自注释与显示名；空白就是代码里没有；
- 计数行；
- 「同名不同值」清单；
- 按应用、文件分组，每个值集合一张小表：成员、值、显示名、注释、位置。

**页面**：
- 页面数据格式升到 `/7`，`technical.dictionaries` 与 `technical.dictionariesState`；
- 技术视图路由 `#/dictionaries` 与侧栏链接；
- 可按应用筛选、按名字搜索；
- 产品视图没有。

### D7 性能

Go 每个目录读一次文件，先收类型再收常量。全项目一次遍历，复用 `data-files.mjs` 的文件清单。

## Risks / Trade-offs

- **JS 靠名字后缀过滤候选**：名字不带这些后缀的值集合看不见，页面写明这条规则；带后缀的配置对象会混进来，抽查覆盖这一类。
- **含义覆盖很低**（语料约 27 处注释）：这是事实，空白照实显示，不让模型补。
- **跨包引用的类型**（`pkg.T` 作为常量类型）进 `otherType`，不解析。

## Oracles

- **O1 抽取**：新夹具 `tests/fixtures/product-handbook/dict-project/`，有 Go、TS、JS 三个应用，覆盖：
  - `iota`、`iota + 1`、`1 << iota`、隐式重复；
  - 类型与常量分在两个文件；
  - 无类型 `iota` 组；
  - 引用别的常量的值；
  - TS 自动递增与字符串成员之后的成员；
  - JS 反向表与非字面成员；
  - 两种注释与隔一行空行的注释；
  - Go `map`、TS `[E.M]` 的显示名，以及一个不对应成员的键；
  - 前后端同名不同值。

  期望值手写。守恒测试逐类核对。

  变异必须各红至少一条：
  - 关掉隐式重复；
  - `iota` 从 1 起；
  - 允许注释与成员之间隔空行；
  - 去掉 JS 名字过滤。
- **O2 呈现**：
  - 技术视图有一节与 `#/dictionaries`，产品视图没有；
  - 缺失与不合格各一行说明；
  - 计数行与清单长度一致。

  变异：产品视图显示这一节，至少一条变红。
- **O3 真实运行**（go-multirepo，Sonnet 是测量条件）：在第 3b 片输出的副本上以 `--sections data --views technical` 续跑。
  - 不派发写作子代理；`state.json` 不变；花费照实记录。
  - 脚本交叉核对：每个成员、注释、显示名的位置那一行确实含有对应的名字或原文，100%。
  - 分层抽查，验收者独立核对，不看实现：
    - 5 个 Go `iota` 集合的值；
    - 5 个 TS 自动递增；
    - 5 个 JS 对象；
    - 全部「同名不同值」；
    - 10 条注释与显示名的归属；
    - 召回：验收者自己 grep 出的值集合声明，被漏掉的数目与原因。
- **O4**：受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑；源码零非 ASCII 字符。
