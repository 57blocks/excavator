## Context

现在 `slices`、`verdicts`、`trace`、`trace-verdicts`、`check-entry` 都以功能 id 为单位：
- 从地图里找功能；
- 用 `entry-shape` 查形状、`items` 取项、`claims` 拼主张；
- 状态读写 `state.features[id]`。

`load-run` 与 `settleState` 要求 `state.features` 的键与地图的功能完全相同。

概览要走同一条核对与追查的路，但它不是地图里的功能，形状也不同。

## Goals / Non-Goals

**Goals**：
- 手册以系统概览开篇，每句都带引文、过两名核对者与两名追查者；
- 能数出来的事实全部由脚本产出；
- 续跑与 `--features` 下的行为与功能一致。

**Non-Goals**：
- 不写系统级发现，那是下一个变更 `handbook-findings`；
- 不做领域间数据流、数据表、代码健康；
- 不给建议；
- 不改核对者与追查者的代理定义。

## Decisions

### D1 单元：功能之外的第二种单元

新增一个小模块，按 id 给出单元的种类。`overview` 是概览；其余 id 必须是地图里的功能，与现在相同。功能 id 都是 `F<n>`，不会撞名。

每种单元提供：
- 形状检查；
- `items` 与 `claims`；
- 状态的读与写。

功能的状态读写 `state.features[id]`，概览的读写 `state.overview`。

`slices`、`verdicts`、`trace`、`trace-verdicts`、`mark` 改为通过单元取这些东西，命令行照旧，只是多认一个 id `overview`。

`state.json` 的格式串不变，只多一个可选键 `overview`。缺这个键时视为 `planned`、`attempts` 为 0，所以旧输出目录续跑时会补写概览，不需要迁移。`load-run` 与 `settleState` 只比 `features` 的键，不变。

理由：复制一套概览专用的核对代码，等于把核对规则写两份，而两份会漂移。

### D2 `entries/overview.json` 的形状

格式串 `excavator-product-handbook-overview/1`：

```
{ format, id: "overview",
  summary:      [{ text, evidence }]                 1 到 3 项
  audiences:    [{ who, does, evidence }]
  applications: [{ dir, name, does, evidence }]      至少 1 项
  integrations: [{ system, use, callers: [dir], evidence }]
  unknowns:     [{ item, searched }] }
```

- `who`、`does`、`name`、`use` 与 `summary.text` 是叙述，走禁词与叙述语言检查。
- `system` 是标签：它必须出现在该项的引文里，与功能条目里的标签同一个检查。
- `dir` 与 `callers` 是项目里的目录路径，不是读者可见的叙述，所以不过禁词检查。
- `who` 不要求是地图的角色：客户、外部候选人、第三方应用也是使用者。
- 引文 SHALL NOT 指向文档文件（`.md`、`.mdx`、`.txt`、`.rst`、`.adoc`）。说明文档可能过时，而概览说的是代码今天的样子。
- 经核对删项后，`summary` 与 `applications` 可以变空。所以定案后的形状（`settled`）允许空数组，与功能条目的 `purpose` 可以被删同理。

主张的拼法沿用 `claims` 的方式：
- 「系统概览 > 用途 > text」；
- 「使用者: who; 做什么: does」；
- 「应用 dir（name）> does」；
- 「外部系统: system; 用途: use; 调用方: dir…」。

连接词全部来自固定文字表。

### D3 应用根目录与守恒

`applications` 模块用与候选列表相同的遍历与跳过规则，找出含构建清单的目录：

```
package.json  go.mod  pom.xml  build.gradle  build.gradle.kts  pyproject.toml
setup.py  requirements.txt  Cargo.toml  composer.json  Gemfile  *.csproj  *.sln
```

应用根目录是这些目录里，与项目根之间没有别的含清单目录的那些。项目根自己含清单时，项目根就是唯一的应用根目录。

`check-overview` 检查：
- 每个 `dir` 含清单，并且是某个应用根目录或位于其下；
- `dir` 不重复；
- 每个应用根目录至少被一个 `dir` 覆盖；
- 每个 `callers` 都是某个 `dir`。

不成立时，逐个打印目录。

### D4 脚本算出的事实（`system-facts`）

`assemble` 与 `page` 调同一个函数，从项目文件、`candidates.json`、`map.json`、已核实的条目算出事实。

**每个应用**：
- 语言：按文件扩展名计文件数，降序；
- 框架：候选里文件落在该应用目录下的框架，按候选数降序；
- 文件数与行数：与候选列表扫描同一批文件，跳过的照样跳过。

**有 git 历史的应用**，额外对该应用目录跑 `git -C <dir> log --no-merges --format=%ad%x09%ae --date=short -- .`，得到：
- 首次与最近提交日期；
- 提交数；
- 作者数（按邮箱去重）。

不在 git 工作区里时，写「没有版本历史」。

**每个区域**：
- 功能数与已核实条目数；
- `who.role` 去重后按地图顺序排列。

**全系统**：上面的汇总，以及地图的角色数。

同样的仓库状态得到同样的字节。日期是提交日期，不是运行时间。

### D5 SKILL.md 的位置与续跑

新增第 3b 阶段「系统概览」，放在 `--features` 解析之后、第 4 阶段之前：

```
状态：verified / confirmed / checked  → 跳过写作
      其余，且 attempts < 2           → mark overview dispatched，前台派一名概览子代理
      子代理返回                       → check-overview overview（失败时按 Next 行重派一次）
```

第 5、6 阶段的单元列表 = 已 `checked` 或 `confirmed` 的概览 + 本次所列的功能。核对、改写、追查的提示词与对功能的完全相同，只是 id 换成 `overview`。

概览子代理的提示词：
- **它读什么**：
  - `map.json` 的区域、功能名与角色；
  - `candidates.json` 的头部；
  - `applications` 命令打印的应用根目录；
  - 各应用的构建清单与入口文件；
  - 搜索外部 SDK、HTTP 客户端与凭据配置的命中。
- **预算**：除构建清单外最多打开 30 个文件，搜索不计。
- **它不读什么**：`.excavator/`、生成的文档、说明文档。
- **它写什么**：只写 `entries/overview.json`，回复前先跑 `try-overview`。

### D6 输出

`handbook.md` 的第一个 `##` 是系统概览：
1. 计数行；
2. 用途；
3. 使用者表；
4. 应用表（目录、名称、负责什么、语言、框架、文件、行数、首次与最近提交、提交数、作者数）；
5. 外部集成表；
6. 区域表（区域、功能数、已核实数、角色）。

概览不是 `verified` 时，这一节只写「系统概览未写成：<步骤>」与区域表。区域表全部由脚本算出，不依赖概览。

页面的概览页在现有统计之下加同样的各节。删去的概览项进覆盖一节「因代码未能证实而被移除的条目」，单元名用固定文字「系统概览」。

## Oracles

**O1（夹具，脚本）**：
- 形状：多键、少键、`summary` 超过 3 项、引文指向 `.md`，各报一行。
- 标签：外部系统名不在引文里，报位置与名字。
- 调用方不是所列应用，报。
- 应用根目录有三个夹具：
  - 两个仓库加一个嵌套的 `package.json`：只有两个根；
  - 根目录含 `go.mod`：唯一的根是项目根；
  - 一个目录不在 git 里。
- 守恒：漏一个、重复一个、指向不含清单的目录，各报。
- 事实：
  - 夹具 git 仓库的提交数、作者数、日期；
  - 不在 git 里的目录写「没有版本历史」；
  - 区域角色只取 `verified` 条目；
  - 两次生成逐字节相同。
- 单元：
  - `slices`、`verdicts`（两轮）、`trace`、`trace-verdicts`、`mark` 对 `overview` 跑通，删项与功能的规则相同；
  - 状态写在 `state.overview`；
  - 没有 `overview` 键的旧状态文件能读。
- 输出：
  - 概览在「功能领域与功能」之前；
  - 未写成时写明停在哪一步；
  - 删去的项出现在覆盖一节。
- 变异检查，各至少一个测试变红：
  - 去掉应用守恒；
  - 去掉系统名的标签检查；
  - 让 `verdicts` 不认 `overview`；
  - 区域角色改为取 `confirmed` 条目。

**O2（合约测试）**：
- SKILL.md 有第 3b 阶段及其派发与检查命令；
- 第 5、6 阶段的单元列表含 `overview`；
- 概览子代理的提示词含预算、不读说明文档、只写 `entries/overview.json` 与 `try-overview`。

**O3（go-multirepo 真实运行；Sonnet 是测量条件）**：
- 输出目录：复制一份已有地图与已核实功能的输出，以 `--features` 指定一个已核实的功能运行。期望只写概览。
- 线：
  - 应用守恒通过，五个应用根目录都被覆盖；
  - 概览达到 `verified`；
  - 一名独立的 Sonnet 审读者逐项对照源码审读留下的每一项，判错的项为 0。
- 只报告：删去的项数、花费、用时。
- 没过的线照实写，不事后挪线。

**O4**：
- 受影响测试、`check-refs`、`openspec validate --all --strict` 在本地通过；
- 全量门在分离检出里跑；
- 源码零非 ASCII 字符。

## Risks / Trade-offs

- 「系统是什么」这类概括句，核对者只看引文，可能大量判 `unverified` 而被删，概览变薄。删去是可见的，可以接受。如果 O3 里 `summary` 全被删，就在验收记录里照实写，下一步再看提示词怎么改。
- 应用根目录的规则在单仓多包（monorepo）里会把整个仓库算成一个根。概览可以在它下面分列子应用，守恒仍然成立。
- 提交统计只在 git 工作区里算。非 git 的项目这几栏写「没有版本历史」，不估算。
