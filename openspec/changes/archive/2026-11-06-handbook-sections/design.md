## Context

`SKILL.md` 现有的阶段，按运行顺序是：第 0 阶段设置 → 1 候选 → 2 固定文字 → 3 地图 → 3c 业务领域 → 3b 系统概览 → 4 条目 → 5 核对 → 6 追查 → 7 拼装。第 5、6 阶段对概览与功能都适用：概览是 id 为 `overview` 的一个单元。各阶段之间按名字互相引用，例如「go to Phase 3b」「as Phase 4 step 3 does」。

## Goals / Non-Goals

**Goals**：
- 每个部分的文字在自己的文件里，只在选中时读；
- 可以只跑一个部分；
- 默认运行的行为与现在相同。

**Non-Goals**：
- 改阶段文字；
- 多个 skill；
- 数据部分。

## Decisions

### D1 文件划分

| 文件 | 内容 | 谁需要它 |
|---|---|---|
| `stages/map.md` | 第 3 阶段与第 3c 阶段，原文 | `overview`、`features` |
| `sections/overview.md` | 第 3b 阶段，原文 | `overview` |
| `sections/features.md` | 第 4 阶段，原文 | `features` |

地图是一个**阶段文件**，不是可选的部分：读者不会单独要一张地图，但概览和功能都依赖它。核对与追查（第 5、6 阶段）是协议，概览与功能共用，留在 `SKILL.md`。

移走的文字逐字不变，包括阶段标题。`SKILL.md` 在第 2 阶段之后加一节「Sections」，规定：
- 跑 `handbook.mjs sections`，按它打印的顺序逐个读文件，读完一个就照它做完，再读下一个；
- 没读的文件里的阶段不跑。文字里的「go to Phase N」，在 Phase N 不跑时，指这次运行要跑的下一个阶段。

### D2 `handbook.mjs sections <list>`

- 取值：`overview`、`features`，用逗号分隔；空或不给时为全部。
- 非法值：退出 1，打印可选值。
- 合法时打印：
  - `SECTIONS=<按固定顺序的清单>`；
  - 每个要读的文件一行 `READ=<相对 skill 目录的路径>`，按运行顺序：先阶段文件，再部分文件；
  - 依赖去重：两个部分都要地图时，`stages/map.md` 只出现一次。
- 依赖表在脚本里，以后的部分加一行：它的文件与它要的阶段文件。

`--sections` 不写进 `state.json`：
- 与 `--views` 一样，它只决定这次跑什么；
- 下次换一组部分续跑时，已完成的部分照旧被跳过。

第 5、6 阶段只处理所选部分的单元：只选 `overview` 时，只核对与追查概览，即使上次运行留下了 `checked` 的功能；只选 `features` 时，概览不进这两个阶段。这一条写进 `SKILL.md` 的「Sections」一节，第 5、6 阶段原文不改。

`--features` 只作用于 `features` 部分。只选 `overview` 时给了 `--features`，`select` 仍按地图解析它（地图照常写），但不派发任何条目子代理。

### D3 拼装不变

`assemble`、`page`、`reply` 不看 `--sections`，照旧拼装输出目录里已有的东西。没跑的部分已经有可见的说明：
- 概览没写时，写一行说明它停在哪一步；
- 没写条目的功能列为「未写」。

## Oracles

**O1（脚本）**：`sections` 命令的测试：
- 默认全选；
- 单选 `overview`、单选 `features`；
- 两个都选时地图只读一次；
- 非法值退出 1 并打印可选值；
- 顺序固定，与参数里写的顺序无关。

**O2（合约测试）**：
- `stages/map.md`、`sections/overview.md`、`sections/features.md` 的内容，分别等于 main 上 `SKILL.md` 里对应阶段的原文。钉死 main 上原文的摘要：任何一个字变了都变红；
- `SKILL.md` 里不再有这些阶段的正文，有「Sections」一节与 `sections` 命令；
- 选项里有 `--sections`。

变异检查（各至少一个测试变红）：
- 部分文件改一个字；
- `sections` 命令漏掉依赖（只选 `overview` 时不打印地图文件）。

**O3（go-multirepo 真实运行；Sonnet 是测量条件）**：两次运行，都在第 2b 片验收输出的副本上续跑。
1. 默认部分，`--features 'Take Leave'`：
   - 线：只重写 `handbook.md`、`handbook.html`（`ui.json` 若有缺键可补译）；地图、`domains.json`、`state.json`、条目与判词逐字节不变；
   - 线：运行记录里，三个文件都在其阶段的第一条命令之前被读到。
2. `--sections overview`：
   - 线：没有派发任何条目子代理；`state.json` 逐字节不变；
   - 线：运行记录里没有读 `sections/features.md`。
- 只报告：两次的花费与用时。

**O4**：
- 受影响测试、`check-refs`、`openspec validate --all --strict` 在本地通过；
- 全量门在分离检出里跑；
- 源码零非 ASCII 字符。

## Risks / Trade-offs

- **模型不读文件、凭记忆做。** O3 查运行记录里的读取时间点。
- **默认运行时三个文件都要读，总字数不变。** 收益在于两点：一是文字在要做的那一步才读到；二是以后加的部分不选就不读。
