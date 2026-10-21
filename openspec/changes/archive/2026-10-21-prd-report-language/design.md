## Context

`/excavator-prd` 的选项写着 `--language` 不指定时「match the codebase's primary human language / the user's request」，又说「This skill's own prose stays English; only the generated PRD follows `--language`」。运行中写给用户的话（Phase 1 打印的流程清单、Phase 2 的大纲、进度说明、最后的回复）没有一句规则。Phase 4 第 6 步是「Offer to write the PRD to the project … Suggest committing it for the team.」。prd 没有契约测试。

基线运行（main 上的 skill，提案前跑过一次）：
- 项目的 `AGENTS.md` 写着 "Reply in Chinese. Lead with conclusions, changes, and verification results."；
- 调用没有指定语言，`--scope` 限定在一个 25 个文件、约 2000 行的桌面程序模块；
- $2.20，47 轮，约 14 分钟。

结果：
- **PRD：** 英文，357 行，0 个汉字；
- **流程清单：** 18 行里 15 行有汉字；
- **进度说明：** 9 段里 7 段是英文，有汉字的 2 段是流程清单与最后的回复；
- **最后的回复：** 中文 16 行，以「结论」开头。核对结果是模型挑过的：说 7 条被改正，列出 4 条。结尾反问「需要我执行 git add/commit 吗？」；
- **保存：** 第 6 步写的是「提议」，模型没有问就把 PRD 写进了项目的 `docs/`。

花费按阶段估算：写完草稿约 $0.6，`excavator-verify` 核对约 $0.9，按核对结果改稿与保存约 $0.4。

hotspots 与 doc-map 的最后回复由一条命令打印，回复就是它的输出。这样模型对上一条命令结果的播报落在这条命令之前，不会并进回复，两处都是 4/4。unused-code 的回复是整份汇报，没法这样做，汇报前多一行的情形没有解决。prd 的回复只有几行，可以照 hotspots 做。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，PRD、流程清单、大纲、进度说明与最后的回复都是英文，项目文件与代码库的语言改变不了；
- 最后的回复只有 PRD 的路径、四项自检的计数与保存的提议，项目文件里关于回复形式的要求改变不了；
- 保存进项目仍是提议，用户同意之前不写进项目；
- 指定 `--language` 时，PRD 与回复的文字用那种语言，路径与数字不变。

**Non-Goals:**
- 不改流程清单、写作规则与源专名规则；
- 不改核对流程。prd 按 `excavator-verify` 的流程核对，verify 自己的语言规则在下一个变更里加；
- 不改第 5 步草稿写在哪里；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里不再试。

## Decisions

### D1 Language 段与 hotspots 的逐字相同

Phase 0 开头一份；Phase 4 第 6 步在回复命令之前一份。Phase 1–4 开头各一行：

> Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

段落用 hotspots 的原文。其中 "the report" 在 prd 里就是 PRD；"the product's values stay as they are" 与 Phase 3 的源专名规则一致。

**选项：**

> `--language <lang>` — the language of the PRD and everything said to the user during the run; English when it is not given.

原来那句「This skill's own prose stays English …」删掉，由选项与 Language 段取代。

**其它措辞：**
- Phase 0 第 1 步：`--language` 改为 `--language` (`$LANGUAGE`: English when it is not given)；
- Phase 3 的三处 `--language` 改为 `$LANGUAGE`：写作语言、Doc Info 的本地化、源专名规则的前提。

### D2 保存与回复：一条命令打印回复的几行

第 6 步改为：

> 6. **Save and reply.** The PRD stays where step 5 wrote it: write it into the project only when the user says so, to `docs/PRD.md` (a scoped PRD: `docs/PRD-<scope>.md`) or a path the user gives.

接着是第二份 Language 段，然后：

> Then print the reply's lines with this command, putting in the PRD's path, the counts steps 1, 2, 4 and 5 report, and the default path:
>
> ```bash
> # the reply: where the PRD is, the counts of the checks and the offer to save it
> printf '%s\n' \
>   "<the PRD's path>" \
>   "<N>/<N> flows covered" \
>   "<N> diagrams" \
>   "<N> terms; 0 translated-variant leaks" \
>   "<N> checked; contradicted <X>, misattributed <Y>; open items resolved <R> (guess wrong <W>), still open <S>" \
>   "To save it in the project, say so: it goes to <default path> unless you give another path. Commit it to share it with the team."
> ```
>
> Reply with exactly the lines it prints and nothing else. Its first line, the PRD's path, is the reply's first line and the offer to save its last: write nothing before, between or after them, no word on the checks, the PRD or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. In a language other than English, write the command's words translated; the path and the numbers stay as they are. When the PRD is already at a path the user gave, leave the last line out.

计数的写法取自第 1、2、4、5 步原文；第 3 步没有计数。「Suggest committing it for the team」并进提议那一行。

**备选：** 像 unused-code 那样只写规则、不用命令。unused-code 两轮都有汇报前多一行的情形；prd 的回复只有几行，命令的办法在 hotspots 与 doc-map 都是 4/4，所以采用命令。

**代价：** 模型要把数字填进命令。填错的数字和写在回复里一样错，命令不核对它们。

### D3 保存仍是提议

第 6 步第一句写明只在用户同意时写进项目。基线里模型没问就写进了 `docs/`，这与原文「Offer」不符。改后回复的最后一行就是这个提议。headless 运行里没人回答，PRD 留在第 5 步的位置。

### D4 契约测试（新建）

- Phase 0–4 按顺序；skill 里没有汉字；
- Language 段两份逐字相同，且与 hotspots 的相同：一份开 Phase 0，一份在第 5 步核对之后、紧挨回复命令的说明之前；Phase 1–4 开头各一行指回它；
- 选项那句在；`--language` 只出现在 `argument-hint`、选项与 Phase 0 第 1 步；Phase 3 写的是 `$LANGUAGE`；
- 一组已知的坏副本都被查出：缺段、改字、挪到核对之前、少一个 phase 的指回行、选项改成按请求；
- D2 的命令与说明原文都在，原来的「Offer to write …」「Suggest committing …」已不在；
- 把命令里的占位换成样例值后实际运行，打印 6 行，第一行是路径。

## Risks / Trade-offs

- 只改提示词，回复里的数字没有确定性的核对。代价由 O3、O4 量出。
- 完整运行贵（基线 $2.20），只跑一次，方差靠缩短运行补。
- headless 运行里 PRD 留在临时位置；交互使用时用户回答一句才写进项目，比改前多一步。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：一个公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实由 `lazy-analyze.mjs` 事先建好，克隆里检查为新鲜；
- 范围：`--scope` 限定在基线用的那个模块；
- 缩短运行：
  - 把基线那次核对过的 PRD 放在项目之外；
  - 附加系统提示：Phase 0–3 与 Phase 4 第 1–5 步已跑完，PRD 在某路径；给出基线报告的计数：11/11 flows、2 diagrams、20 terms、30 checked、contradicted 7、misattributed 0、resolved 0、guess wrong 0、still open 2；
  - 要求只做第 6 步；
  - 工具限 Bash、Read、Write；
- 完整运行：不加提示、不限工具，从 Phase 0 跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**回复的判据：**
- 回复与最后一条 Bash 命令的输出逐行相同（去掉行尾空白与末尾空行）；
- 6 行，第一行是一个存在的 `.md` 文件的路径，且这个文件是这次的 PRD；
- 缩短运行：给出的计数原样出现在回复里；
- 项目目录里（`.excavator` 之外）没有新文件。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉 Phase 0 的 Language 段；
  - 改掉第 6 步那份的一个词；
  - 把第 6 步那份挪到第 5 步核对之前；
  - 删掉 Phase 2 开头的指回行；
  - 选项改成「不指定时跟随代码库语言」；
  - Phase 3 的 `$LANGUAGE` 改回 `--language`；
  - 删掉回复命令的提议那一行；
  - 删掉「项目文件的回复要求不适用」那句；
  - 删掉译出那句；
  - 恢复「Suggest committing it for the team.」；
  - skill 里加一个汉字。
- **O2 基线：** 已在提案前跑过，见 Context。
- **O3 缩短运行，不指定语言：** 3 次，每次上限 $0.5。每次回复满足判据，回复与主会话写给用户的每段文字（去掉代码后）汉字与假名为 0。
- **O4 完整运行，不指定语言：** 1 次，上限 $3.5。满足：
  - 回复满足判据；
  - 主会话每段文字汉字与假名为 0，包括流程清单与大纲；
  - PRD 文件代码之外汉字与假名为 0。
- **O5 缩短运行，`--language Chinese`：** 1 次，上限 $0.5。满足：
  - 回复与最后一条 Bash 命令的输出逐行相同；
  - 第 2–6 行每行都有汉字；
  - 第一行的路径与给出的相同；
  - 给出的计数原样出现。

  进度说明的语言照记，不作判据。
- **O6 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O7 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
- **花费：** 含基线合计不超过 $9，超出即停，照记。

## 验收记录

**提交序列：** 按 tasks.md 的四个 commit。运行与 O1 的变异测的都是第 3 个 commit 之后的 skill，第 4 个 commit 只有文档。

**夹具：** 一个公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 按 oracle 所写，事实事先建好，`--scope` 限定在基线用的那个模块。缩短运行用基线那次核对过的 PRD（357 行，英文），放在项目之外。

**O1 装置：** 每个变异单独做，做完还原，全部变红：

| 变异 | 变红的测试 |
|---|---|
| M1 删掉 Phase 0 的 Language 段 | Language 段的位置；坏副本 |
| M2 改掉第 6 步那份的一个词 | Language 段的位置；坏副本；回复命令与说明 |
| M3 第 6 步那份挪到第 5 步核对之前 | Language 段的位置；回复命令与说明 |
| M4 删掉 Phase 2 开头的指回行 | Language 段的位置；坏副本 |
| M5 选项改成跟随代码库语言 | 默认英文；Language 段的位置 |
| M6 Phase 3 的 `$LANGUAGE` 改回 `--language` | Phase 3 用 `$LANGUAGE` |
| M7 删掉回复命令的提议那一行 | 回复命令与说明；命令打印 6 行 |
| M8 删掉项目文件那句 | 回复命令与说明 |
| M9 删掉译出那句 | 回复命令与说明 |
| M10 恢复「Suggest committing it for the team.」 | 只提议保存 |
| M11 skill 里加一个汉字 | 五个 phase；没有汉字 |

还原后契约测试 12 项全绿。

**O2 基线（main 上的 skill，提案前）：** 复现，见 Context。按判据全部不过：回复不是命令的输出、不是 6 行、第一行不是路径、有汉字，主会话有汉字，PRD 写进了项目的 `docs/`。

**运行：**

| 运行 | 花费 | 轮数 | 主会话文字段数（含汉字） | 回复 | 判据 |
|---|---|---|---|---|---|
| 缩短 1 | $0.087 | 3 | 1（0） | 命令的 6 行，英文 | 过 |
| 缩短 2 | $0.089 | 3 | 1（0） | 命令的 6 行，英文 | 过 |
| 缩短 3 | $0.076 | 2 | 2（2） | 命令的 6 行，提议那一行是中文 | 不过：有汉字 |
| 缩短，`--language Chinese` | $0.093 | 2 | 1（1，即回复） | 命令的 6 行，第 2–6 行中文 | 过 |
| 完整 | $2.106 | 43 + 6 | 10（0） | 命令的 6 行，英文 | 过 |

- **O3 不过（2/3）。** 缩短 3 先写了一句中文的说明，说第 6 步只是保存与回复、没要求存入项目所以不动；然后在命令里把提议那一行译成了中文。回复与命令的输出逐行相同，路径与计数都对，不过的是语言。按事先的写法照记，不再迭代：n=3 里一次失败，换措辞再跑 3 次分不出效果与噪声。
- **O4 通过。**
  - 打印的流程清单（15 项）、大纲与其余进度说明都是英文；
  - PRD 289 行，代码之外 0 个汉字，留在第 5 步写下的临时位置，项目里没有新文件；
  - 回复是命令的 6 行：15/15 flows、4 diagrams、8 terms、20 checked、contradicted 1。

  核对子代理在后台运行时，主会话先结束了一轮，回复是一句「草稿已写好，核对在后台运行，完成后继续」。子代理完成后会话又续了 6 轮，最后的回复是命令的输出。判据按最后一轮的回复判。两条 result 报的累计花费相同，都是 $2.106。
- **O5 通过。** 回复与命令的输出逐行相同；第 2–6 行都是中文，路径与给出的相同，计数原样。进度说明：回复之前没有写给用户的文字。

**O6 全量门**（最终提交的分离检出）：
- `pnpm -r build`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`（44 项）都退出 0；
- `pnpm --filter @excavator/core test`：1437 项通过；
- `pnpm test`：152 个文件 4106 项通过、4 项跳过，退出 0。

**O7 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。

**花费：** 基线与 5 次运行合计 $4.65，上限 $9。

**结论：**
- 不指定语言时，完整运行里 PRD、流程清单、大纲、进度说明与回复都是英文。基线里打印的流程清单与回复是中文。
- 回复的形式在 5/5 次运行里都是命令打印的那几行，没有摘要、结论或反问。
- 保存只是提议，5/5 都没有写进项目。
- 项目文件仍可能改变语言：英文缩短运行 3 次里有 1 次被带成中文，未解决。

**局限：**
- 缩短运行跳过了 Phase 0，模型没有在第一句话之前读到并执行开头那份 Language 段的情境；完整运行只跑了一次。
- 指定语言的情形只跑了中文，只跑了缩短运行；PRD 正文在另一种语言下的写法，本变更没有改，也没有重跑。
- 核对按 `excavator-verify` 的流程进行，verify 自己写给用户的话还没有语言规则，在下一个变更里处理。
