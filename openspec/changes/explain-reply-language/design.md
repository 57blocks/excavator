## Context

`/excavator-explain` 有八步指令，没有选项。第 8 步列了解释要讲的六点（角色、内部结构、外部连接、数据流、讲清楚、值得注意的模式），没有说回复的形式。基线见 proposal：解释是中文，以项目文件要的「## 结论」开头。

onboard 与 prd 的回复只有几行，由最后一条命令打印。explain 的回复就是解释本身，几十行；回复只给路径会把答案藏起来。这里先把解释写进数据目录里的文件，再由最后一条命令打印整份文件：回复的结构由固定标题定，回复与解释的一致由命令定。第一版没有这一步，见 D2。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，进度说明与解释都是英文，项目文件改变不了；
- 解释有固定的结构：五个标题按顺序，第一个标题之前、最后一节之后没有文字，项目文件里关于回复形式的要求改变不了；
- 指定 `--language` 时，解释与标题用那种语言，代码标识符与路径不变。

**Non-Goals:**
- 不改读图谱的第 3–7 步与解释讲的五方面；
- 不处理图谱没有层与摘要时解释的质量；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里照记，不作判据。

## Decisions

### D1 Language 段与 hotspots 的逐字相同

`## Instructions` 开头一份；第 7 步之后、第 8 步之前一份，因为解释在第 8 步写。

**选项**，加在标题说明之后的 `## Options` 一节：

> `$ARGUMENTS` holds the component to explain and may hold `--language <lang>`: the language of the explanation and everything said to the user during the run; English when it is not given.

frontmatter 的 `argument-hint` 改为 `"[file-path] [--language <lang>]"`。第 2 步解析 `PROJECT_ROOT` 的命令块里加 `LANGUAGE="English"   # or the --language value`，与 hotspots 相同。第 3 步改为查 `$ARGUMENTS` 里点名的组件，去掉 `--language` 与它的值，否则模型会拿整串参数去查。

### D2 解释写进文件、由最后一条命令打印，用五个固定标题

第 8 步与新加的第 9 步：

> 8. **Write the explanation** in `$LANGUAGE`, as markdown, to `.excavator/explanation.md` in the project, replacing any earlier one, under these five `##` headings, in this order:
>    - **Role**: its role in the architecture (which layer, why it exists)
>    - **Internal Structure**: functions and classes it contains (from `contains` edges)
>    - **External Connections**: what it imports, what calls it, what it depends on (from edges)
>    - **Data Flow**: inputs → processing → outputs (from source code)
>    - **Worth Knowing**: patterns, idioms or complexity worth understanding
>
>    Explain clearly, assuming the reader may not know the programming language. The file starts with the first heading and ends with the last section's text. In a language other than English, write the headings translated; code identifiers and paths stay as they are.
>
> 9. **Reply.** Print the explanation with this command, run from the project root:
>
>    ```bash
>    # the reply: the explanation
>    cat .excavator/explanation.md
>    ```
>
>    Reply with exactly the lines it prints and nothing else: write nothing before or after them, no word on what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.

五个标题就是改前第 8 步的五方面；「讲清楚」一点是写法，不是一节，放在列表之后。

**为什么固定标题：** 项目文件的「先说结论」能插进来，是因为回复没有形式。固定的标题加上「文件以第一个标题开头」与「回复只能是命令打印的内容」，开头只能是第一个标题，也能逐次核对。

**为什么由命令打印：** 第一版第 8 步让模型直接把解释写成回复，并要求第一个标题之前不写任何文字。O3 三次里有一次，回复第一行是一句进度说明（「I now have everything needed to write the explanation.」），接着才是第一个标题：模型把对上一步的播报与回复写在了同一条消息里。onboard 与 prd 的回复由最后一条命令打印，播报落在命令之前，不会并进回复；这里照搬，解释先写进文件，最后一条命令 `cat` 它。第一版的运行见验收记录。

**备选：** 像 onboard 那样把解释写进 `.excavator/` 再回复路径。否决：explain 是一问一答，答案就是解释，回复只给路径要用户多打开一个文件。

### D3 提醒写在第一个标题下

第 2 步的 `stale` 与 `missing` 两条改为写在解释第一个标题下的第一行。解释写进文件、文件以第一个标题开头之后，原来的「解释之前提醒」与它冲突。

### D4 契约测试（新建）

- frontmatter 的名字与 `argument-hint`；skill 里没有汉字；
- Language 段与 hotspots 的逐字相同，出现两次：一份开 `## Instructions`，一份紧挨第 8 步之前、在第 7 步之后；
- 选项那句在；第 2 步的命令块设 `LANGUAGE`；第 3 步去掉 `--language`；
- 一组已知的坏副本都被查出：缺段、不在开头、自成一节、不在第 8 步之前、挪到第 7 步之前、挪到最后、改字、选项改成跟随项目；
- 第 8 步的开头句在，列出的标题依次是那五个，文件以第一个标题开头那句在；
- 第 9 步的命令与说明在，skill 以它们结尾；在临时项目里写一份解释再实际运行这条命令，输出与文件逐字相同；
- D3 两句在，改前的「warn before explaining」已不在。

## Risks / Trade-offs

- 只改提示词，没有确定性的核对；代价由 O3、O4 量出。回复与文件是否相同靠模型照抄，由 O3 核对。
- `.excavator/explanation.md` 每次覆盖，只留最后一次的解释。
- 固定标题让很小的组件也要写满五节；某节没有内容时模型会写一句说明。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：前几个语言变更用过的公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实事先建好，克隆里检查为新鲜，图谱没有层记录；
- 解释的对象：基线用的那个 Java 类，按路径给出；
- 完整运行：不加提示、不限工具，从头跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**回复的判据：**
- 回复与最后一条 Bash 命令的输出逐行相同（去掉行尾空白与首尾空行）；
- 回复的第一个非空行是第一个标题；
- 回复里的 `##` 标题恰好五个，按顺序；
- 项目目录里（`.excavator` 之外）没有新文件。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉开头那份 Language 段；
  - 改掉第 8 步之前那份的一个词；
  - 把第 8 步之前那份挪到第 7 步之前；
  - 选项改成「不指定时跟随项目」；
  - 删掉第 2 步的 `LANGUAGE=` 一行；
  - 删掉第 3 步去掉 `--language` 那半句；
  - 删掉「文件以第一个标题开头、以最后一节结尾」那句；
  - 删掉「项目文件的回复要求不适用」那句；
  - 删掉译出那句；
  - 删掉一个标题，或调换两个标题的顺序；
  - 恢复「warn before explaining」；
  - skill 里加一个汉字；
  - 命令改成打印别的文件；
  - 删掉「回复只能是它打印的内容」那句；
  - 删掉第 9 步。

  后三个是第二版（D2）加的。
- **O2 基线：** 已在提案前跑过，见 proposal。
- **O3 完整运行，不指定语言：** 3 次，每次上限 $1。每次：
  - 回复满足判据，五个标题依次是 Role、Internal Structure、External Connections、Data Flow、Worth Knowing；
  - 主会话每段文字（去掉代码后）汉字与假名为 0。
- **O4 完整运行，`--language Chinese`：** 1 次，上限 $1。满足：
  - 回复满足判据；
  - 五个标题都有汉字，回复代码之外有汉字。

  进度说明的语言照记，不作判据。
- **O5 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
- **花费：** 含基线合计不超过 $4，超出即停，照记。

## 验收记录

- **O2：** 见 proposal（$0.36）。
- **第一版（回复直接写解释，第一个标题之前不写）的 O3、O4：** 4 次。

  | 运行 | 花费 | 轮 | 用时 | 回复行数 | 结果 |
  |---|---|---|---|---|---|
  | O3 第 1 次 | $0.42 | 11 | 94 s | 34 | 满足 |
  | O3 第 2 次 | $0.52 | 13 | 133 s | 31 | 满足 |
  | O3 第 3 次 | $0.36 | 10 | 114 s | 47 | **不满足**：回复第一行是「I now have everything needed to write the explanation.」，第二行起才是第一个标题 |
  | O4 | $0.38 | 11 | 113 s | 55 | 满足：标题「角色」「内部结构」「外部连接」「数据流」「值得了解的地方」 |

  失败的那次，进度说明与解释写在了同一条消息里。因此改为第二版（D2）：解释写进文件，由最后一条命令打印。
- **O1（第二版）：** 设计里列的各项（「删掉一个标题，或调换两个标题的顺序」各做一个）共 16 个变异，都让契约测试变红，做完已还原；还原后 9 个测试全绿。
- **第二版的 O3：** 3 次都满足，回复与最后一条命令 `cat .excavator/explanation.md` 的输出逐行相同。

  | 次 | 花费 | 轮 | 用时 | 回复行数 | 进度说明 |
  |---|---|---|---|---|---|
  | 1 | $0.46 | 13 | 136 s | 59 | 5 段，英文 |
  | 2 | $0.46 | 13 | 130 s | 63 | 3 段，英文 |
  | 3 | $0.48 | 12 | 126 s | 56 | 2 段，英文 |

  每次：第一行是 `## Role`，五个标题依次是 Role、Internal Structure、External Connections、Data Flow、Worth Knowing；回复代码之外的汉字与假名为 0；项目目录里（`.excavator` 之外）没有改动。
- **第二版的 O4：** $0.49，14 轮，145 s，59 行。第一行是第一个标题，五个标题是「角色」「内部结构」「外部连接」「数据流」「值得了解」，回复代码之外有汉字，项目里没有改动。**「回复与命令输出逐行相同」严格地说不满足**：59 行里有 37 行不同，不同处全是全角标点（`，：（）`）在回复里成了半角，两边做 NFKC 规范化后完全相同。模型照抄中文时改了标点宽度；内容、行数与标题都没变。只有这一次，没有再改措辞重跑。进度说明 3 段都是英文（照记，不作判据）。
- **运行所用的版本：** 第二版的运行用的是 adcb2c2a。之后的 bb8e77c8 只改了图谱过期时那句提醒的措辞，夹具的图谱是新鲜的，运行里走不到那一句。
- **花费：** 基线 $0.36，第一版 $1.67，第二版 $1.90，合计 $3.93，未超过 $4。
- **O5（本地）：** 第一版的头上，全量测试查出共用的新鲜度测试失败（任务 1.6 已修），其余失败都是与真实运行并行时的超时。bb8e77c8 上：构建、类型检查、全量 4145 个测试、core 1437 个测试、引用检查与 `openspec validate --all --strict` 都通过。
- **O6：** 推送前扫了本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文：隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
