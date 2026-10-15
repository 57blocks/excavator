## Why

Core 的默认忽略规则里有一类「文件规则」：不以 `/` 结尾，用来排除某种文件，如 `LICENSE`、`*.lock`、`*.log`、`*.map`。
- gitignore 语义下，这种规则同样匹配目录；
- `ignore` 库默认不区分大小写。

所以名叫 `license`、`License` 的源码目录整个被排除，目录里的源码文件在选择边界就被拒绝，所有阶段都看不到。

在本地语料上只读实测，被默认规则拒绝的源码文件里，`LICENSE` 匹配目录的有：
- Dataverse：一个 Java 包，3 个文件；
- koel：一个 PHP 目录，7 个文件；
- 一个私有 C# 语料：一个目录，4 个文件。

其余文件规则在这些语料上没有匹配到目录，但写法相同，同样会出这个问题。

这不只是覆盖缺口，也是编造源。按类型注入一类阶段的正确性依赖「仓库里的声明都看得见」：被拒绝的文件里若有某个类型的实现，候选集就不完整，可能把边连到另一个实现上。上一个变更的验收发现了这条路径。

## What Changes

- 默认规则里每条文件规则（不以 `/` 结尾、不以 `!` 开头）只排除文件，不再排除同名目录。
  - 匹配这些规则的文件照旧排除，包括大小写不同的写法；
  - 名为 `license` 等的目录及其下的文件按其余规则正常选择。
- 实现是结构化的：从默认规则里的文件规则机械派生对应的目录取反规则，接在默认规则之后。不为某一条规则单独写例外，以后新加的文件规则自动适用。
- 用户规则不受影响：项目根 `.excavatorignore` 与 CLI 规则排在默认规则之后，写 `license/` 仍可排除该目录。
- 选择策略的版本标签 `source-selection-v1` 不变。默认规则本身已写进选择描述符，选择摘要因此改变，所以每个项目的下一次同步会做一次完整的确定性重投影。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `source-selection-safety`：新增要求「默认的文件规则不排除目录」。

## Impact

- 代码：
  - `packages/core/src/ignore-filter.ts`：派生取反规则；`DEFAULT_IGNORE_PATTERNS` 是 `createIgnoreFilter` 与 `createSourceSelectionPolicy` 的共同来源；
  - 测试：`packages/core/src/__tests__/ignore-filter.test.ts`、`source-selection.test.ts`，以及按需钉住选择描述符或摘要的测试。
- 产物：
  - 有这类目录的项目，选中文件变多，事实图多出这些文件的节点与边；
  - 所有项目的选择摘要改变，下一次同步完整重投影一次；
  - 语义层按文件内容缓存，不受影响。
- 不改：
  - 目录规则（`build/`、`out/`、`dist/`、`target/` 等）。它们本意就是排除目录，但会误伤同名的源码包（TomEE examples 有一个 Java 包叫 `out`）。判断哪个目录是构建产物，要按模块根定位，另立变更；
  - 选择策略的判定顺序、敏感文件与归档规则。
