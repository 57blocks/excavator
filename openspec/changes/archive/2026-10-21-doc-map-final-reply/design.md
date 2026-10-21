## Context

第 7 步最后一段：

> Then reply in `$LANGUAGE` with these lines and nothing else: the report's path, the first two lines of the counts query, the line of the check query, the first line of the coverage query and the line `advice check: 0 lines`. Do not summarize the report or add notes.

上一个变更的验收运行 3 里，回复前面多了一句 "The advice check printed 0 lines. Report written to `.excavator/doc-map-report.md`."。那次夹具的 `AGENTS.md` 写着 "Reply in Chinese. Lead with conclusions, changes, and verification results."：
- 语言那一半已被 Language 段挡住，回复是英文；
- 形式那一半没有被任何一句挡住：多出的句子正是「验证结果 + 结论」，放在最前面。

「nothing else」与「add notes」都没点名位置。模型把开头那句当作回复的引子，而不是回复内容之外的附注。

## Goals / Non-Goals

**Goals:** 项目文件要求「先说结论与验证结果」时，最后的回复仍只有固定的几行，第一行是报告路径。另外从第 1 步跑完一次完整的真实运行。

**Non-Goals:**
- 不改 Language 段：它在第 1 步与第 7 步逐字相同，由契约测试比对；
- 不改报告内容与其它步骤；
- 不处理子代理写的标题与复核理由的语言；
- 不做 `--language` 指定别的语言时的真实运行。

## Decisions

### D1 最后回复那句点名首尾，并压过项目文件的回复形式要求

第 7 步最后一段改为：

> Then reply in `$LANGUAGE` with these lines and nothing else: the report's path, the first two lines of the counts query, the line of the check query, the first line of the coverage query and the line `advice check: 0 lines`. The report's path, alone and with no label, is the reply's first line and `advice check: 0 lines` its last: write nothing before, between or after them, no word on the advice check, the report or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.

按「规则写在模型动手的地方」，两句都放在这一段里，不另开一节。

备选：
- 加一条命令打印回复，要求回复就是它的输出：问题不是行写错了，而是多了一句话，命令挡不住多写；还要把三个查询再抄一遍。不采用。（第一轮验收后改为采用，见 D3：多出的那句来自最后一条命令之后的播报位置，加一条命令正好把这个位置挪到回复之前。）
- 把「项目文件改变不了回复形式」写进 Language 段：那段讲语言，两处逐字相同，放进去会把形式规则藏在语言规则里，离写回复的地方也更远。不采用。
- 用脚本检查回复：回复是模型的最后一条消息，发出之前没有地方跑脚本。做不到。

代价：最后一段多两句。

### D2 契约测试钉住两句和位置

两句原文都在第 7 步，并且这一段是第 7 步的最后一段（在 Language 段之后）。

### D3（第一轮验收后加）回复的几行由一条命令打印

第一轮按 D1 改后，4 次运行（3 次缩短、1 次完整）路径前的标签都没有了，但回复前仍各多一句自检结果，如 "The advice check printed nothing, so the report is ready."。

消息流说明了原因：
- 模型每跑完一条命令，都先说一句结果，再说下一步；
- 自检是最后一条命令，它之后就是回复，这句播报与回复并成了最后一条消息；
- 回复那段的禁令挡不住，因为模型把这句当成命令之间的进度说明，而 Language 段允许进度说明。

改为：自检之后，用一条命令打印回复的几行，回复就是它打印的行：
- 自检结果的播报落在这条命令之前，是一条合法的进度说明；
- 最后一条命令之后，只剩它的输出可回；
- D1 的两句放在这条命令之后，「路径单独一行、不加标签」由命令的输出代替；
- 命令里的三个查询与报告用的查询逐字相同，契约测试比对，并在夹具产物上跑出期望的几行。

代价：skill 多一条命令，三个查询重复一次。

## Risks / Trade-offs

- 只改提示词，没有确定性的地板。代价由 O3、O4 量出；改后仍出现时，下一步考虑让回复只剩一行报告路径。
- 缩短运行用一句附加系统提示让模型只做第 7 步，这句提示本身是英文，可能影响形式。完整运行（O4）没有这句提示，用来对照。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：一个公开 Go 示例仓库的 APFS 克隆，在 scratchpad 里。根目录 `CLAUDE.md` 引入 `AGENTS.md`，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."；
- 文档：项目外一个文档目录，一份英文用例文档，三条用例，其中一条项目里没有；
- 缩短运行的产物由 skill 自己的命令确定性建好（`read`、`units`、`link`、复核计划与合并、`link`、`coverage`），事实由 `lazy-analyze.mjs` 生成。

**缩短运行：**
- 环境：Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，工具限 Bash、Read、Write，调用不带 `--language`；
- 附加系统提示：第 1–6 步已跑完，只做第 7 步。

**回复的判据：** 去掉空行、代码围栏行、行首的列表符号与反引号之后，回复的行逐行等于期望的行：
- 第一行是报告路径（绝对路径，或相对项目目录的路径）；
- 其后依次是计数查询的前两行、复核查询那一行、覆盖查询的第一行（用 skill 的查询在产物上算出）、`advice check: 0 lines`。

被去掉的格式照记。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红：
  - 删掉首尾那句；
  - 删掉项目文件那句；
  - 把最后一段挪到 Language 段之前。
- **O2 基线（真实运行的装置）：** 用改前的 skill（main）跑缩短运行，至多 2 次，每次上限 $0.5。
  - 至少一次回复不满足判据：夹具能复现；
  - 两次都满足：记为没复现，O3 只能说明没有回退，证明不了修复。
- **O3 改后：** 同样的缩短运行跑 3 次，每次上限 $0.5。通过条件：3 次回复都满足判据。
- **O4 完整运行：** 改后的 skill，事先删掉 `.excavator`，不加附加提示，从第 1 步跑完，上限 $3。通过条件：
  - 回复满足判据；
  - 主会话写给用户的每段文字（不含子代理的消息，去掉代码后）汉字与假名为 0；
  - 报告汉字与假名为 0，自检 0 行。
- **O5 全量门：** `pnpm -r build`、`pnpm test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O6 隐私：** 本变更的文档、提交信息、改动行与 PR 正文，三条隐私检查与测试语料名单都为 0。
- **花费：** 合计不超过 $6，超出即停，照记。

## 验收记录

**提交序列：** 按 tasks.md 的四个 commit。第 3 个（D3）是第一轮验收没过之后加的，第一轮的结果照记在下面。

**夹具：** 一个公开 Go 示例仓库的 APFS 克隆，`AGENTS.md` 按 oracle 所写。缩短运行的产物：文档 1 份读入，单元 3 条，找到代码 2 条、没找到 1 条；覆盖统计 36 个文件，其中文档 3 个、代码 33 个。

**O1 装置：** 每个变异单独做，做完还原。全部变红：

| 轮 | 变异 | 变红的测试 |
|---|---|---|
| D1 | F1 删首尾那句 | step 7 ends with the reply |
| D1 | F2 删项目文件那句 | step 7 ends with the reply |
| D1 | F3 最后一段挪到 Language 段之前 | Language 段的两项与 step 7 ends with the reply |
| D1 | F4 删 "alone and with no label" | step 7 ends with the reply |
| D3 | G1 删首尾那句 | step 7 ends with the reply |
| D3 | G2 删项目文件那句 | step 7 ends with the reply |
| D3 | G3 命令里计数查询只取一行 | prints the reply's lines with the report's own queries |
| D3 | G4 删掉回复命令 | prints the reply's lines with the report's own queries |
| D3 | G5 Language 段挪到回复之后 | Language 段的两项与 step 7 ends with the reply |

还原后契约测试 36 项全绿。

**O2 基线（main 上的 skill）：** 1 次即复现，第 2 次没跑。

| 运行 | 花费 | 回复开头 | 判据 |
|---|---|---|---|
| base1 | $0.222 | "The advice check printed nothing." 加一行带 "Report:" 标签的路径 | 不过 |

**第一轮（D1）：** 4 次全不过。路径前的标签没有了，语言都是英文，但回复前都多一句自检结果。

| 运行 | 花费 | 多出的那句 | 判据 |
|---|---|---|---|
| after1 缩短 | $0.222 | "The advice check prints nothing, so the report is ready." | 不过 |
| after2 缩短 | $0.233 | "The advice check printed nothing, so the report is ready." | 不过 |
| after3 缩短 | $0.220 | "Advice check passed with 0 lines." | 不过 |
| full1 完整 | $1.524 | "The advice check printed 0 lines. The report is complete." | 不过 |

full1 的其余判据都过：主会话 19 段文字汉字与假名为 0，报告汉字与假名为 0，自检 0 行。消息流里的诊断见 D3。

**第二轮（D3）：** 4 次全过。每次最后一条命令都是回复命令，自检结果的播报都落在它之前（如 "Advice check passed with 0 lines. Printing the final reply."），最后一条消息只有它打印的几行，没有要去掉的格式。

| 运行 | 花费 | 轮数 | 主会话文字段数（含汉字或假名） | 报告汉字与假名 | 自检 | 判据 |
|---|---|---|---|---|---|---|
| cmd1 缩短 | $0.228 | 6 | 3（0） | 0 | 0 行 | 过 |
| cmd2 缩短 | $0.217 | 7 | 4（0） | 0 | 0 行 | 过 |
| cmd3 缩短 | $0.265 | 9 | 4（0） | 0 | 0 行 | 过 |
| full2 完整 | $1.517 | 29 | 16（0） | 0 | 0 行 | 过 |

O3 通过（3/3）。O4 通过：full2 事先删掉 `.excavator`，不加附加提示，从第 1 步跑完，用时约 300 秒。

**O5 全量门**（在提交 59cbc6a2 的分离检出上）：`pnpm -r build`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`（45 项）都退出 0；`pnpm --filter @excavator/core test` 62 个文件 1437 项通过；`pnpm test` 151 个文件 4082 项通过、4 项跳过，退出 0。

**O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0。

**花费：** 9 次运行合计 $4.65，上限 $6。

**局限：**
- 缩短运行带一句英文附加系统提示，只读项目设置、不加载 MCP，工具限 Bash、Read、Write；完整运行只读项目设置、不加载 MCP，不加提示、不限工具。
- 回复仍由模型写，没有确定性的地板。D3 让最后一条消息之前没有可播报的结果，但模型仍可以在命令输出之外多写；4 次里没有出现。
- 没有做 `--language` 指定别的语言时的真实运行。
