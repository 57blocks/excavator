## Context

`/excavator-hotspots` 没有语言选项，也没有任何一句说写给用户的话用什么语言。第 4 步的固定措辞都是英文，自检的第二行模式是同样的词的中文版，「给中文报告用」，也就是默认了报告可能是中文。最后一段是：

> Then reply with the report's path and the line `advice check: 0 lines`, and do not summarize the report: it holds the numbers in the words these steps give, and a summary rewords them. Point the user at `/excavator-chat` for questions about one file or directory; it answers from the same product.

基线运行（main 上的 skill，提案前跑过一次，$0.45）：项目的 `AGENTS.md` 写着 "Reply in Chinese. Lead with conclusions, changes, and verification results."，调用没有指定语言。
- 报告：整份中文，239 行里 38 行有汉字，标题、小节名与正文都是中文；
- 最后的回复：中文，「报告已写入 `.excavator/hotspots-report.md`。」，然后是 `advice check: 0 lines`，再加一句指向 `/excavator-chat`；
- 主会话 6 段写给用户的话里 1 段是中文，是最后那条回复。

同样的两个缺陷在 `/excavator-chat` 与 `/excavator-doc-map` 上已经按真实运行修过：
- 语言：规则要放在模型动手写的地方，逐字相同地放两处，并写明项目文件的回复语言要求在 skill 运行时被取代；
- 回复形式：自检是最后一条命令时，它的结果播报会并进最后一条消息；改为最后用一条命令打印回复的几行，播报就落在这条命令之前。

本变更把这两处做法照搬到 hotspots。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，运行中写给用户的话、报告与最后的回复都是英文，项目文件改变不了；
- 指定 `--language` 时，这些都用指定的语言，固定措辞译出；
- 最后的回复只有报告路径与 `advice check: 0 lines` 两行。

**Non-Goals:**
- 不改脚本、产物与查询；
- 不改 `/excavator-chat` 的改动历史问答，它的回答语言已由 chat 自己的规则管；
- 不扩展自检的词表到中英文以外的语言；
- 不把 Language 段与 doc-map 的做成共享文件：两个 skill 各自安装、各自读，段落里提到的来源也不同（doc-map 有文档与子代理）。

## Decisions

### D1 Language 段，第 1 步开头与最后回复之前各一份

> **Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

与 doc-map 的段落相比，只去掉了 hotspots 没有的来源（文档、子代理的回复）与没有的对象（id、引文）。

第 2–4 步开头各一行：

> Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

选项一句：`--language <lang>`: the language of the report and everything said to the user during the run; English when it is not given. 第 1 步的变量块加 `LANGUAGE="English"   # or the --language value`，frontmatter 的 `argument-hint` 加 `[--language <lang>]`。

### D2 报告用 `$LANGUAGE`，固定措辞译出

第 4 步第一句改为 "Write the report to `$DATA/hotspots-report.md` in `$LANGUAGE`, in this order:"，紧接一句 "The words these steps give in quotes are for an English report; in another language, write them translated."。

译文的说法不再是逐字固定的。这是指定别的语言的代价；自检第二行的中文词表仍能抓中文报告里的建议与因果说法。

备选：每条固定措辞后面都加「（换语言时译出）」，doc-map 就是这么做的。hotspots 第 4 步有 8 处固定措辞，逐处加会让本就很长的条目更长；一句放在写报告那一刻的说明足够。

### D3 指向 chat 的那句挪进报告末尾

报告顺序加第 12 条：用固定的话收尾，"For questions about one file or directory, /excavator-chat answers from the same product."。

原来这句在回复里。回复改成命令打印的固定两行之后（D4），这句只能放在报告里，才能随报告用 `$LANGUAGE`。

### D4 最后的回复由一条命令打印

自检之后：

> （Language 段）
>
> Then print the reply's lines with this command:
>
> ```bash
> # the reply: the report's path and the advice check's line
> echo "$DATA/hotspots-report.md"; echo 'advice check: 0 lines'
> ```
>
> Reply with exactly the lines it prints and nothing else. Its first line, the report's path, is the reply's first line and `advice check: 0 lines` its last: write nothing before, between or after them, no word on the advice check, the report or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.

与 doc-map 的做法相同，只是 hotspots 的回复没有计数行。

代价：两行也用一条命令打印。没有这条命令，自检就是最后一条命令，它的结果播报会并进回复，doc-map 第一轮 4/4 就是这样失败的。

### D5 契约测试

- Language 段两份逐字相同：一份开 Step 1，一份紧挨在回复命令之前、自检之后；第 2–4 步开头各一行指回它；选项那句在；
- 一组已知的坏副本（缺段、改字、段落挪到回复之后、少一步的指回行、选项改成「按请求」）都被查出；
- 回复那段的三句原文、第 4 步结尾就是它们；
- 回复命令逐字钉住，并在夹具产物的目录上运行，输出正好是两行；
- 报告用 `$LANGUAGE`、译出固定措辞那句、第 12 条收尾句都在；收尾句过得了自检；
- skill 里没有汉字（自检的中文词是 `\u` 转义）。

### D6（第一轮验收后加，第二轮后撤回）第 1 步打印语言

第一轮里，指定 `--language Chinese` 的那次运行：报告是中文，固定措辞译出了，回复正确；但主会话 8 段写给用户的话全是英文。模型在第一条命令里设了 `LANGUAGE="Chinese"`，此后的进度说明仍跟着英文的 skill 与调用写。不指定语言的 3 次运行都通过，这一缺陷只在指定别的语言时出现。

改为：第 1 步的变量块在 `LANGUAGE` 之后打印一行 `write every line to the user in: $LANGUAGE`。
- 依据：chat 的回答语言靠一条命令修好，命令的输出是写答案前最后读到的内容；doc-map 的记录也表明，进度说明的第一句定调，后面跟着它。
- 这一行出现在模型第一次开口之前，不靠它记住 Language 段。

代价：第 1 步多一行输出。

结果：第二轮那次中文运行抄第 1 步的变量块时漏掉了这一行，没有执行它，叙述仍全是英文。模型会跳过的一行没有显示出效果，撤回，skill 回到第一轮的样子。

## Risks / Trade-offs

- 只改提示词，没有确定性的地板。代价由 O3、O4 量出。
- 指定别的语言时，进度说明仍是英文（两轮都没解决，见验收记录）：报告与回复守住了，命令之间写给用户的话没有守住。
- 指定别的语言时，固定措辞的译法每次可能不同；自检只有中英文词表，别的语言的报告里的建议说法抓不到。
- 回复仍由模型写。命令让最后一条消息之前没有可播报的结果，但模型仍可以在命令输出之外多写。

## 验收 oracle（动手前写死）

**夹具：** 一个公开 Java 示例仓库（162 个提交）的 APFS 克隆，在 scratchpad 里。根目录 `CLAUDE.md` 引入 `AGENTS.md`，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."。没有分组文件与领域图。

**运行：** 每次一份新克隆，Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，不加附加提示，从第 1 步跑完。

**回复的判据：** 去掉空行、代码围栏行、行首的列表符号与反引号之后，回复正好两行：报告路径（绝对路径，或相对项目目录的路径）、`advice check: 0 lines`。被去掉的格式照记。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉第 1 步的 Language 段；
  - 改掉第 4 步那份的一个词；
  - 把第 4 步那份挪到回复命令之后；
  - 删掉第 3 步开头的指回行；
  - 选项改成「不指定时按请求的语言」；
  - 删掉回复段的首尾那句；
  - 删掉回复段的项目文件那句；
  - 回复命令少打印自检那一行；
  - 删掉译出固定措辞那句；
  - 删掉第 12 条收尾句；
  - skill 里加一个汉字。
- **O2 基线：** 已在提案前跑过，见 Context。至少一项不满足 O3 的判据即算复现。
- **O3 改后，不指定语言：** 跑 3 次，每次上限 $1。每次都要满足：
  - 回复满足判据；
  - 主会话写给用户的每段文字（去掉代码后）汉字与假名为 0；
  - 报告汉字与假名为 0；
  - 用 skill 的自检脚本查报告，0 行；
  - 报告的最后一条是指向 `/excavator-chat` 的收尾句。
- **O4 改后，`--language Chinese`：** 跑 1 次，上限 $1。要满足：
  - 回复满足判据；
  - 报告的每个标题行都有汉字；第 4 步给定的三句英文固定措辞（作者份额、去掉测试的文件对、计入 0 次提交的文件）原文都不出现；
  - 主会话写给用户的每段文字（去掉代码后），有英文单词的都有汉字；
  - 用 skill 的自检脚本查报告，0 行。
- **第二轮（D6 之后）：** `--language Chinese` 再跑 1 次，判据同 O4；不指定语言再跑 1 次，判据同 O3，查有没有回退。各上限 $1。第二轮仍不过就照记，不再迭代。
- **O5 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0。
- **花费：** 含基线合计不超过 $5，超出即停，照记。

## 验收记录

**提交序列：** 按 tasks.md 的六个 commit。第 4 个（D6）是第一轮之后加的，第 5 个是第二轮之后把它撤回。最终的 skill 与契约测试和第 3 个 commit 之后逐字相同，第一轮的 3 次英文运行测的就是这个版本。

**夹具：** 一个公开 Java 示例仓库（162 个提交、364 个文件）的 APFS 克隆，`AGENTS.md` 按 oracle 所写，没有分组文件与领域图。

**O1 装置：** 每个变异单独做，做完还原，全部变红：

| 变异 | 变红的测试 |
|---|---|
| M1 删掉第 1 步的 Language 段 | Language 段的位置；坏副本 |
| M2 改掉第 4 步那份的一个词 | Language 段的位置；坏副本；第 4 步以回复结尾 |
| M3 第 4 步那份挪到回复命令之后 | Language 段的位置；第 4 步以回复结尾 |
| M4 删掉第 3 步开头的指回行 | Language 段的位置；坏副本 |
| M5 选项改成按请求的语言 | 默认英文；Language 段的位置；坏副本 |
| M6 删掉回复段的首尾那句 | 第 4 步以回复结尾 |
| M7 删掉回复段的项目文件那句 | 第 4 步以回复结尾 |
| M8 回复命令少打印自检那一行 | 回复命令的输出 |
| M9 删掉译出固定措辞那句 | 默认英文 |
| M10 删掉第 12 条收尾句 | 第 4 步的规则 |
| M11 skill 里加一个汉字 | 没有汉字 |
| M12（D6）删掉打印语言那一行 | 默认英文 |

还原后契约测试 32 项全绿。

**O2 基线（main 上的 skill，提案前）：** 复现。

| 运行 | 花费 | 回复 | 主会话文字段数（含汉字） | 报告 |
|---|---|---|---|---|
| hbase1 | $0.448 | 不过：中文一句引子、`advice check: 0 lines`、中文一句指向 chat | 6（1） | 239 行里 38 行有汉字 |

**第一轮（D1–D4）：**

| 运行 | 花费 | 轮数 | 回复 | 主会话文字段数（含汉字） | 报告汉字 | 自检 | 报告最后一句 | 判据 |
|---|---|---|---|---|---|---|---|---|
| hen1 | $0.428 | 10 | 过 | 6（0） | 0 | 0 行 | chat 那句 | 过 |
| hen2 | $0.421 | 10 | 过 | 9（0） | 0 | 0 行 | chat 那句 | 过 |
| hen3 | $0.513 | 14 | 过 | 6（0） | 0 | 0 行 | chat 那句 | 过 |
| hzh1 `--language Chinese` | $0.458 | 11 | 过 | 8（0） | 1371 字 | 0 行 | chat 那句的中文 | 不过：叙述全英文 |

- O3 通过（3/3）。每次最后一条命令都是回复命令，回复没有要去掉的格式。
- O4 不过。其余各项都过：
  - 报告 12 个标题行都有汉字；
  - 三句英文固定措辞原文都没出现；
  - 回复两行；
  - 自检 0 行。

  没过的是主会话 8 段写给用户的话：都有英文单词、没有汉字。模型在第一条命令里设了 `LANGUAGE="Chinese"`，此后的进度说明仍是英文。

**第二轮（D6）：**

| 运行 | 花费 | 轮数 | 回复 | 主会话文字段数（含汉字） | 报告汉字 | 自检 | 判据 |
|---|---|---|---|---|---|---|---|
| hzh2 `--language Chinese` | $0.485 | 14 | 过 | 8（0） | 1169 字，13 个标题行都有 | 0 行 | 不过：叙述全英文 |
| hen4 | $0.441 | 11 | 过 | 8（0） | 0 | 0 行 | 过 |

hzh2 抄第 1 步的变量块时漏掉了打印语言那一行，没有执行它。按事先的约定不再迭代，D6 撤回（见 D6）。hen4 说明不指定语言的情形没有回退。

**O5 全量门**（最终提交的分离检出）：
- 推送前查出第 2 个 commit 的测试里，汉字范围被写成了真字符，而不是 `\u` 转义。改回转义、重放后面的 commit 之后，门在最终提交上重跑；
- `pnpm -r build`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`（44 项）都退出 0；
- `pnpm --filter @excavator/core test`：1437 项通过；
- `pnpm test`：151 个文件 4088 项通过、4 项跳过，退出 0。

**O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0。

**花费：** 7 次运行合计 $3.19，上限 $5。

**结论：**
- 不指定语言时，项目文件改变不了语言，最后的回复只有两行：4/4 通过；
- 指定 `--language` 时，报告与回复守住了，进度说明没有守住：2/2 不过，未解决。

**局限：**
- 运行只读项目设置、不加载 MCP，调用里没有别的话；真实使用时，用户用另一种语言写的请求可能把进度说明带向那种语言，没有测。
- 指定语言的情形只跑了中文。
- `/excavator-doc-map` 同样没有做过指定语言的真实运行，进度说明大概率有同样的缺口，不在本变更里处理。
