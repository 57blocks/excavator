# 验收记录：handbook-verdict-only-rewrite

被验收的提交：`6a61c33b`（脚本与测试 `8c6a6047`，SKILL.md 与合约测试 `6a61c33b`），基于 main `866bd2a5`。

## O1 夹具与变异检查

夹具测试覆盖 design O1 的每一条：
- 第一轮删 `contradicted`、只把 `unverified` 写进改写文件；
- 只有 `contradicted` 时直接 `confirmed`；
- 删完没有带证据的项时 `failed`；
- 第二轮接受只换引文的项，拒绝改了主张的项；
- 第一轮已删项缺失不报 `missing`；
- 最终 `removed` 含两轮的记录。

三个变异检查，各自变红的测试数：

| 变异 | 变红的测试 |
|---|---|
| 去掉第一轮删除（`roundOne` 里 `ids: []`） | 13 个，含 `removes a contradicted item at once…`、`confirms the feature at once, with what it removed and no rewrite file…`、`fails the feature at verify…`、`ends with the records of both rounds` |
| 去掉主张比较 | 5 个，含 `refuses a listed item whose text changed…` 及规则、状态、通知、字段下挂规则、操作名各一 |
| 去掉第一轮已删项的豁免（空集合） | 7 个，含 `does not report the removed items as missing…`、`refuses an item that comes back after round 1 removed it` |

与设计不同的地方（实现时发现，按下面的做法处理）：
- **数组路径会前移。** 删掉 `states[0]` 后，原来的 `states[1]` 变成 `states[0]`。新增 `lib/shift-paths.mjs`，第一轮写改写文件、第二轮读快照时，都换算成删后条目的路径。快照文件本身不改，与 D2 一致。
- **改写期间要保留第一轮的删除记录。** `check-entry` 原来在 `rewriting` 状态下重建状态时会丢掉 `removed`，现在保留。
- **第一轮删掉用途时，条目没有 `purpose` 键。** 只有 `state.removed` 记录了它被删，才允许缺。
- **最终 `removed` 里的路径不在同一个坐标系。** 第一轮的记录用删前路径，第二轮的用删后路径。这个字段只用来展示和校验状态，没有代码回读，追查阶段的记录原本也是这样。

## O2 合约测试

改写提示词去掉了「narrow the text」，改为只换引文，并说明 `slices --round 2` 会拒绝改了主张的项。`verdicts --round 1` 的新输出行写进 SKILL.md：
- `<id>: confirmed, <n> items removed` 与 `No rewrite file: no item is left to rewrite`；
- `<id>: <n> items removed` 与 `<id>: <n> items to rewrite`；
- `<id>: failed at verify: no item could be proved`。

合约测试断言了这些内容。

## O3 已知错误库（真实运行）

测量条件：Sonnet，A 组与 B 组各一次，每组花费上限 $15。打分按主张原文对应条目，因为路径会前移，旧的按路径打分会对错项。打分脚本先在旧运行上验过，恰好找出已知的两次改写（T22、K1）。

| | 线 | A 组 | B 组 | 结果 |
|---|---|---|---|---|
| (a) 最终条目里主张与第一轮不同的项 | 0 | 0 / 24 | 0 / 36 | 通过 |
| (b) 真话被改写成假话 | 0 | 0 | 0 | 通过 |
| (c) 删去或纠正的错误 | ≥ 7 / 14 | 12 / 14（留下 K9、K3） | — | 通过 |
| (d) 被删的真话 | 只报告 | 5 / 13 | 11 / 27 | — |
| 第一轮判 `contradicted` 直接删的项 | | T22、X1、K1、K8 | T15、K7b 孪生 | |
| 花费 | | $3.93 | $4.02 | 共 $7.95 |

对照（同一个库，旧流程）：
- main 纠正 6/14，#112 纠正 7/14；
- 真话被改成假话：七次运行共 6 次，其中「说明可以不填」改成「必填」3 次、X1 改错 3 次。

**代价**：被删的真话从每次 1–2 项升到 A 组 5/13、B 组 11/27。大多是第二轮两名核对者在补了引文后仍判 `unverified` 的项。以前它们会被改写（收窄文字）后留下，现在删去，并在覆盖一节列出。

库里的真话是按「与错误相近」挑的孪生项，比一般条目难核，所以这个删除率不代表普通功能上的覆盖损失。

## O4 门

- 受影响测试：手册测试目录与合约测试，23 个文件、619 个测试通过（本地不含 `page-browser`，它需要构建好的页面）。
- 全量门在分离检出 `6a61c33b` 上跑：安装、构建、类型检查通过，`check-refs` 通过，`openspec validate --all --strict` 56/56；292 个测试文件、6892 个测试通过，4 个跳过，含 `page-browser`。
- 源码零非 ASCII 字符。
