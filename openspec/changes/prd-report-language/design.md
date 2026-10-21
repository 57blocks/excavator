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
