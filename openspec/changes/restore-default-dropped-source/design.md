## Context

动机见 proposal.md。现状：

- 选择边界是 `createSourceSelectionPolicy`，默认规则 `DEFAULT_IGNORE_PATTERNS` 排在最前，项目根 `.excavatorignore` 与 CLI 规则依次在后。
  - 按 gitignore 语义，后面的取反规则 `!<目录>/` 能把被默认目录规则排除的目录找回。
  - 前提是它的上级目录没有被排除。
- 敏感文件、分析数据与归档在任何规则之前判定，取反规则找不回它们。
- 宿主 skill 第 0 阶段 6.4 是"忽略规则预检"。它在根 `.excavatorignore` 不存在、有旧版规则文件、或用户要求时运行，做法是：
  1. 跑基线扫描；
  2. 发现生成产物目录的候选；
  3. 用 `--exclude` 跑比较扫描；
  4. 审查改前选中、改后不选中的路径；
  5. 写入根文件；
  6. 复核。
- 现在的预检只往"多排除"一个方向走，不看默认规则已经排除的东西。
- 规格要求"项目相关的选择判断"由宿主 skill 根据扫描证据做出，并且只以项目自己的根规则持久化。

## Goals / Non-Goals

**Goals：**
- 默认目录规则按名字误排的源码包，能在预检里被找回。依据是文件自己的包声明，找回结果经过前后比较的审查。
- 运行时零改动：选择结果、选择摘要、事实图都不变。

**Non-Goals：**
- 仓库里存在、但分析没有读的 JVM 源文件在解析中的语义。这包括被项目规则排除、文件太大被跳过、读取失败的文件。
  - 现状一：调用解析把指向它们的调用判为"仓库外"。
  - 现状二：按类型注入判唯一候选时不考虑它们。
  - 这与目录规则无关，另立变更。实测数据见「实测记录」。
- Go 仓库 `build/` 下的打包文件（Dockerfile 等）。它们不是源码包，`build/` 规则按本意排除，现状不变。
- 已有根规则文件的项目自动复查。预检的触发条件不变。

## Decisions

### D1 判断放在宿主 skill，不改运行时

**备选方案 A：在 Core 选择策略里加例外。** 一个被默认目录规则排除的 JVM 源文件，如果扫描本来就会读的前 4 KB 里的包声明覆盖了被命中的目录，就选中它。

不采用，理由：
- 用户定的原则是"AI 能做的不写进代码"。规格也把"项目相关的选择判断"交给宿主 skill。这个 `out/` 是构建产物还是源码包，正是这类判断，而且模型读一行包声明就能可靠地判断。
- 方案 A 要改三处：选择策略（新增描述符，所有项目的选择摘要都会变，下次同步全部重投影）；只按路径判定的 `createIgnoreFilter`（增量路径要读文件头才能与快照一致）；以及 Core 里一份 TS 版的包声明解析。
- 实测只有 3 个文件受益，代价与收益不相称。

**代价：**
- 找回只在预检运行时发生，依赖模型照做。
- 已有根规则文件的项目要用户要求复查才会找回。
- 没找回之前，覆盖缺口仍在扫描的 `filteredByDefaults` 计数里可见。

### D2 依据是文件自己的包声明覆盖每一个命中目录

一条取反规则只在以下条件下提议：被排除文件的 `package`（或 `namespace`）声明，包含它路径上被默认目录规则命中的每一个目录。

- `src/main/java/org/acme/out/A.java` 声明 `package org.acme.out;`：命中的 `out` 在包路径里，算源码包。
- `target/generated-sources/annotations/com/acme/Foo.java` 声明 `package com.acme;`：命中的 `target` 不在包路径里，是生成代码，不提议。
- `vendor/org/lib/Bar.java` 声明 `package org.lib;`：同理，是第三方库，不提议。
- `target/gen/com/acme/out/X.java` 声明 `package com.acme.out;`：`out` 在包路径里，`target` 不在，不提议。即使提议，上级 `target/` 已被排除，取反也无效，比较时会因"不改变选择结果"被放弃。

不采用的依据：
- 目录名本身：默认规则正是按名字判定才出的错。
- 源码扩展名或手写的样子：第三方库与生成代码同样满足。

### D3 规则写在模型做决定的那一步

- 找回候选的说明写进 6.4 第 3 步（发现候选），因为模型在这一步决定提议哪些规则。
- 审查找回路径的说明写进第 5 步（比较），因为模型在这一步决定放弃哪些规则。
- 报告要求写进第 8 步。

契约测试按段落断言，不只断言全文出现。

## Risks / Trade-offs

- [模型不照做，漏找] → 缺口仍可见（`filteredByDefaults`），与现状相同，不会更糟。O3 用真实模型验收。
- [模型找错，把生成代码或第三方库找回] → D2 的依据加第 5 步逐条审查；O3 用含第三方库目录的语料做反向对照。
- [取反规则写成上级目录，范围过大] → 规格要求只取反源码包这一个目录；第 5 步审查要求找回的文件都属于该包。

## 验收 Oracle（动手前写死）

全部 build-free，语料只读（只在 scratchpad 的副本上运行），产物不进仓库。

- **O1 契约测试**：
  - 第 3 步段落含找回候选与 D2 的依据；
  - 第 5 步段落含审查找回路径与两条放弃条件；
  - 第 8 步含找回路径的报告。
  - 把 SKILL.md 恢复成旧文本后，测试全部变红。
- **O2 机制（确定性，无模型）**：在 TomEE examples 副本上：
  - 两条取反规则（`src/main/java/...` 与 `src/test/java/...` 下的 `ws/out/`）正好找回 3 个 Java 文件，不丢任何文件；
  - 对照组：取反一个不存在的目录，选择结果不变。
  - 已在提案前实测通过。
- **O3 真实模型**：Sonnet，`--max-budget-usd 3`，两次运行顺序进行，不并行。
  - TomEE examples 副本（无根规则文件）：预检提议的取反规则正好找回这 3 个文件，写入根文件且复核一致；没有找回任何第三方库或生成代码。
  - koel 副本（无根规则文件，含 `resources/assets/css/vendor/`、`resources/views/vendor/` 与 `.vscode/`）作反向对照：不提议任何取反规则。
  - 记录每次花费（被中止的运行写"未记录，上限 $3"）。
- **O4 不回归**：`node scripts/check-refs.mjs` 与 `pnpm exec vitest run --maxWorkers=4` 通过。运行时代码不变，所以不做事实图对比。

## 实测记录（提案前，只读）

**本地 32 个语料根目录**（git 仓库按 `ls-files -co --exclude-standard` 枚举，非 git 目录逐层遍历）：只因默认目录规则被排除的文件分组如下。
- 源码包：TomEE examples 的 `org.superbiz.ws.out`，main 与 test 共 3 个 Java 文件。它在 git 与非 git 两份副本里各出现一次。
- 第三方库：
  - odoo 的 bootstrap `dist/`、pdfjs `build/`；
  - sakai 的 jstree `dist/`；
  - hadoop 的 xterm `dist/`；
  - 两个私有前端的 `public/vendor/`、`assets/vendor/`；
  - koel 的 `css/vendor/`、`views/vendor/`。
- 构建与打包文件：Seam 的 `build/`（Ant 构建脚本）、三个私有 Go 仓库的 `build/Dockerfile`、一个私有 PHP 站点的 `css/build`、`scripts/build`。
- IDE 与工具目录：`.vscode/`、`.gradle/`、`.claude/`、`.agents/`。

**仓库里存在但没有读的 JVM 源文件（Non-Goals）**：按 HEAD 内容：
- TomEE examples 的那 3 个文件；
- hadoop 的 1 个超大文件 `Hamlet.java`。它所在包里还有 4 个文件，所以对它的调用已判为"仓库内无法解析"，没有错标。

另有两个 git 语料是部分克隆加稀疏检出，工作区里有几千个 Java 文件读失败。这是语料自身的状态。

**按类型注入的隐藏候选**：仓库里有任何 Kotlin 或 Scala 声明，非 final 的注入类型都判"隐藏候选"。在 cargotracker 与 daytrader8 的副本里各加一个 Kotlin 空类：
- cargotracker 的按类型 `injects` 边 24 → 0；
- daytrader8 的按类型 `injects` 边 19 → 0。

TomEE examples 本来就有 3 个 Scala 文件，125 个按类型注入点全部是隐藏候选，0 条边。如果把未读的 Java 文件也按这条规则处理，一个文件就会清空整个仓库的按类型注入。所以 Non-Goals 那一项要另做按范围限定的设计，不在本变更内。
