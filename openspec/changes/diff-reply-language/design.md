## Context

`/excavator-diff` 有七步指令，没有选项。第 7 步列了分析要讲的四方面（改了什么、影响什么、涉及哪些层、风险），外加一句「建议要仔细审什么」，没有说回复的形式。基线见 proposal：分析是中文，以项目文件要的「## 结论」开头。

onboard 与 prd 的回复只有几行，由最后一条命令打印。diff 的回复就是分析本身，几十行；回复只给路径会把答案藏起来。这里先把分析写进数据目录里的文件，再由最后一条命令打印整份文件：回复的结构由固定标题定，回复与分析的一致由命令定。第一版没有这一步，见 D2。explain 的同一做法在另一个变更里（explain-reply-language）。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，进度说明与分析都是英文，项目文件改变不了；
- 分析有固定的结构：五个标题按顺序，第一个标题之前、最后一节之后没有文字，项目文件里关于回复形式的要求改变不了；
- 指定 `--language` 时，分析与标题用那种语言，代码标识符与路径不变。

**Non-Goals:**
- 不改取改动文件与读图谱的第 2–6 步；
- 不处理图谱没有层与摘要时分析的质量；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里照记，不作判据。

## Decisions

### D1 Language 段与 hotspots 的逐字相同

`## Instructions` 开头一份；第 6 步之后、第 7 步之前一份，因为分析在第 7 步写。

**选项**，加在标题说明之后的 `## Options` 一节：

> `--language <lang>` — the language of the analysis and everything said to the user during the run; English when it is not given.

frontmatter 加 `argument-hint: "[--language <lang>]"`。第 3 步解析 `PROJECT_ROOT` 的命令块里加 `LANGUAGE="English"   # or the --language value`，与 hotspots 相同。

### D2 分析写进文件、由最后一条命令打印，用五个固定标题

第 7 步与新加的第 8 步：

> 7. **Write the analysis** in `$LANGUAGE`, as markdown, to `.excavator/diff-analysis.md` in the project, replacing any earlier one, under these five `##` headings, in this order:
>    - **Changed Components**: what was directly modified (with summaries from matched nodes)
>    - **Affected Components**: what might be impacted (from 1-hop edges)
>    - **Affected Layers**: which architectural layers are touched and cross-layer concerns
>    - **Risk Assessment**: based on node `complexity` values, number of cross-layer edges, and blast radius (number of affected components)
>    - **Review Focus**: what to review carefully and any potential issues
>
>    The file starts with the first heading and ends with the last section's text. In a language other than English, write the headings translated; code identifiers and paths stay as they are.
>
> 8. **Reply.** Print the analysis with this command, run from the project root:
>
>    ```bash
>    # the reply: the analysis
>    cat .excavator/diff-analysis.md
>    ```
>
>    A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.

前四个标题就是改前第 7 步的四方面；改前那句「建议要仔细审什么」原来没有标题，成为第五节。

**为什么固定标题：** 项目文件的「先说结论」能插进来，是因为回复没有形式。固定的标题加上「文件以第一个标题开头」与「回复只能是命令打印的内容」，开头只能是第一个标题，也能逐次核对。

**为什么由命令打印：** 第一版第 7 步让模型直接把分析写成回复，并要求第一个标题之前不写任何文字。O3 三次里有一次，回复第一行是一句进度说明（「I have enough context from the knowledge graph. Let me write up the analysis.」），接着才是第一个标题：模型把对上一步的播报与回复写在了同一条消息里。onboard 与 prd 的回复由最后一条命令打印，播报落在命令之前，不会并进回复；这里照搬，分析先写进文件，最后一条命令 `cat` 它。第一版的运行见验收记录。

**备选：** 把分析写进 `.excavator/` 再回复路径。否决：diff 是看完改动立刻要读的，回复只给路径要用户多打开一个文件。

### D3 提醒写在第一个标题下

第 3 步的 `stale` 与 `missing` 两条改为写在分析第一个标题下的第一行。分析写进文件、文件以第一个标题开头之后，原来的「分析之前提醒」与它冲突。

### D4 契约测试（新建）

- frontmatter 的名字与 `argument-hint`；skill 里没有汉字；
- Language 段与 hotspots 的逐字相同，出现两次：一份开 `## Instructions`，一份紧挨第 7 步之前、在第 6 步之后；
- 选项那句在；第 3 步的命令块设 `LANGUAGE`；
- 一组已知的坏副本都被查出：缺段、不在开头、自成一节、不在第 7 步之前、挪到第 6 步之前、挪到最后、改字、选项改成跟随项目；
- 第 7 步的开头句在，列出的标题依次是那五个，文件以第一个标题开头那句在；
- 第 8 步的命令与说明在，skill 以它们结尾；在临时项目里写一份分析再实际运行这条命令，输出与文件逐字相同；
- D3 两句在，改前的「warn before impact analysis」已不在。

## Risks / Trade-offs

- 只改提示词，没有确定性的核对；代价由 O3、O4 量出。回复与文件是否相同靠模型照抄，由 O3 核对。
- `.excavator/diff-analysis.md` 每次覆盖，只留最后一次的分析。
- 改动很小时也要写满五节；某节没有内容时模型会写一句说明。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：前几个语言变更用过的公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实事先建好，克隆里检查为新鲜，图谱没有层记录；
- 改动：每份克隆里把基线用的那个 Java 常量的默认值改掉，不提交；
- 完整运行：不加提示、不限工具，从头跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**回复的判据：**
- 回复与最后一条 Bash 命令的输出逐行相同（去掉行尾空白与首尾空行）；
- 回复的第一个非空行是第一个标题；
- 回复里的 `##` 标题恰好五个，按顺序；
- 项目目录里（`.excavator` 之外）除了夹具的那处改动，没有别的改动与新文件。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉开头那份 Language 段；
  - 改掉第 7 步之前那份的一个词；
  - 把第 7 步之前那份挪到第 6 步之前；
  - 选项改成「不指定时跟随项目」；
  - 删掉第 3 步的 `LANGUAGE=` 一行；
  - 删掉「文件以第一个标题开头、以最后一节结尾」那句；
  - 删掉「项目文件的回复要求不适用」那句；
  - 删掉译出那句；
  - 删掉一个标题，或调换两个标题的顺序；
  - 恢复「warn before impact analysis」；
  - skill 里加一个汉字；
  - 命令改成打印别的文件；
  - 删掉「回复只能是它打印的内容」那句；
  - 删掉第 8 步。

  后三个是第二版（D2）加的。
- **O2 基线：** 已在提案前跑过，见 proposal。
- **O3 完整运行，不指定语言：** 3 次，每次上限 $1。每次：
  - 回复满足判据，五个标题依次是 Changed Components、Affected Components、Affected Layers、Risk Assessment、Review Focus；
  - 主会话每段文字（去掉代码后）汉字与假名为 0。
- **O4 完整运行，`--language Chinese`：** 1 次，上限 $1。满足：
  - 回复满足判据；
  - 五个标题都有汉字，回复代码之外有汉字。

  进度说明的语言照记，不作判据。
- **O5 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
- **花费：** 含基线合计不超过 $4，超出即停，照记。

## 验收记录

- **O2：** 见 proposal（$0.31）。
- **第一版（回复直接写分析，第一个标题之前不写）的 O3、O4：** 4 次。

  | 运行 | 花费 | 轮 | 用时 | 回复行数 | 结果 |
  |---|---|---|---|---|---|
  | O3 第 1 次 | $0.53 | 14 | 131 s | 38 | 满足 |
  | O3 第 2 次 | $0.39 | 12 | 102 s | 40 | **不满足**：回复第一行是「I have enough context from the knowledge graph. Let me write up the analysis.」，第二行起才是第一个标题 |
  | O3 第 3 次 | $0.40 | 10 | 96 s | 46 | 满足 |
  | O4 | $0.47 | 16 | 163 s | 54 | 满足：标题「变更组件」「受影响组件」「受影响的架构层」「风险评估」「审查重点」 |

  失败的那次，进度说明与分析写在了同一条消息里。因此改为第二版（D2）：分析写进文件，由最后一条命令打印。
- **O1（第二版）：** 设计里列的各项（「删掉一个标题，或调换两个标题的顺序」各做一个）共 15 个变异，都让契约测试变红，做完已还原；还原后 9 个测试全绿。
- **第二版的 O3：** 3 次都满足，回复与最后一条命令 `cat .excavator/diff-analysis.md` 的输出逐行相同。

  | 次 | 花费 | 轮 | 用时 | 回复行数 | 进度说明 |
  |---|---|---|---|---|---|
  | 1 | $0.45 | 17 | 132 s | 32 | 3 段，英文 |
  | 2 | $0.52 | 14 | 133 s | 43 | 3 段，英文 |
  | 3 | $0.38 | 12 | 104 s | 34 | 2 段，英文 |

  每次：第一行是 `## Changed Components`，五个标题依次是 Changed Components、Affected Components、Affected Layers、Risk Assessment、Review Focus；回复代码之外的汉字与假名为 0；项目目录里（`.excavator` 之外）除了夹具的那处改动没有别的改动。
- **第二版的 O4：** $0.45，12 轮，142 s，48 行。第一行是第一个标题，五个标题是「变更组件」「受影响组件」「受影响的架构层」「风险评估」「审查重点」，回复代码之外有汉字，项目里没有别的改动。**「回复与命令输出逐行相同」严格地说不满足**：48 行里有 5 行不同，不同处全是全角标点（`，：（）`）在回复里成了半角，两边做 NFKC 规范化后完全相同。只有这一次，没有再改措辞重跑。进度说明 2 段，是中文（照记，不作判据）。
- **运行所用的版本：** 第二版的运行用的是 cf04db95。之后的 0bd7030f 只改了图谱过期时那句提醒的措辞，夹具的图谱是新鲜的，运行里走不到那一句。
- **花费：** 基线 $0.31，第一版 $1.80，第二版 $1.80，合计 $3.90，未超过 $4。
- **O5（本地）：** 第一版的头上，全量测试查出共用的新鲜度测试失败（任务 1.6 已修），其余失败除 `test_large_repo_benchmark` 的两个（数整机共享临时目录，见 onboard 的记录）外都是与真实运行并行时的超时。0bd7030f 上构建与类型检查通过，全量测试跑到一半为收尾停掉；契约测试与新鲜度测试 16 个通过。以 PR 上的 CI gate 为准。
- **O6：** 推送前扫了本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文：隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
