## Context

`/excavator-unused-code` 没有语言选项，也没有一句说写给用户的话用什么语言。它不写报告文件：第 6 步先用 `jq` 取各节，再「Report, in this order:」列出 7 项，最后的回复就是这份汇报。规则里的最后一条是「Point the user at `/excavator-chat` …」。

基线运行（main 上的 skill，提案前跑过一次，$1.91，43 轮，约 12 分钟）。项目的 `AGENTS.md` 写着 "Reply in Chinese. Lead with conclusions, changes, and verification results."，调用没有指定语言：
- **汇报语言：** 中文，68 行，代码之外 739 个汉字；
- **汇报顺序：** 第一节是「结论」，里面有对项目的介绍和对计数原因的解释，这些都不是产物里的字段，计数排到了第二节；
- **主会话：** 8 段写给用户的话里 3 段是中文。前两段中文，之后转成英文；
- **入口决定的理由：** 17 条都是英文，写理由时叙述已经转成英文。

`/excavator-hotspots` 刚按同样的缺陷改过：
- 不指定语言时 4/4 通过；
- 指定 `--language` 时，报告守住了，命令之间的进度说明没有守住，记为未解决。

本变更照搬它的语言规则，只有一处不同：unused-code 的回复就是汇报，不是两行固定的话。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，运行中写给用户的话、入口决定的理由与汇报都是英文，项目文件改变不了；
- 汇报按第 6 步的顺序，以计数开头、以指向 chat 的那句结尾，项目文件里关于回复形式的要求改变不了；
- 指定 `--language` 时，汇报用那种语言，固定措辞译出。

**Non-Goals:**
- 不改脚本、产物、可信度规则与第 3 步判断入口的规则；
- 不把汇报改成写进文件。那是改产品形态，和语言无关；
- 不加汇报的自检脚本；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里不再试。

## Decisions

### D1 Language 段与 hotspots 的逐字相同

第 1 步开头一份；第 6 步在取各节的 `jq` 块之后、汇报的说明之前一份。第 2–6 步开头各一行：

> Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says.

段落用 hotspots 的原文，两个 skill 说法一致：

> **Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory and the system locale do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, commands and the product's values stay as they are.

选项一句：`--language <lang>`: the language of the report, the reasons of your decisions and everything said to the user during the run; English when it is not given. 第 1 步的变量块加 `LANGUAGE="English"   # or the --language value`，`argument-hint` 加 `[--language <lang>]`。

### D2 入口决定的理由用 `$LANGUAGE`

第 4 步的规则「`reason` names the caller and the mechanism you established in Step 3, in one sentence.」后面加 "in `$LANGUAGE`"。理由进产物，第 6 步第 6 项把它列给用户，所以和汇报同一种语言。doc-map 的复核理由也是这么定的。

### D3 汇报就是回复：首尾固定，项目文件的回复形式要求不适用

Language 段之后、「Report, in this order:」之前：

> Your reply is the report, in `$LANGUAGE`: it opens with the counts and ends with the line on `/excavator-chat`; write nothing before or after them, and no summary or conclusion of your own. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. The words these steps give in quotes are for an English report; in another language, write them translated.

汇报顺序加第 8 项：Close with the words "For questions about one method, file or group, /excavator-chat answers from the same product."。规则里原来指向 chat 的那条删掉，否则同一件事说两遍。

备选：像 hotspots 那样用命令打印回复。unused-code 的回复是整份汇报，没有固定的行可打印；改成写文件再打印路径，又是改产品形态。不采用。

代价：第 6 步多三句；汇报最后一句是固定的话。

### D5 汇报以固定的词开头（第一轮验收后加）

第一轮缩短运行 3 次里有 2 次开头不是计数：
- 一次在计数前加了标题「Unused code report」；
- 一次把一句叙述（"I have everything needed for the report."）并进了回复开头。

两次的第二行都是「Counts:」。同一轮里，结尾那句是固定措辞，5 次运行都一字不差地以它结尾；开头只是描述，4 次英文运行里守住 2 次。

所以开头也给固定的词：
- D3 的首尾那句改成：it starts with the words "Counts:" and ends with the line on `/excavator-chat`; write nothing before or after them, not even a line on what you ran or found, and no summary or conclusion of your own.
- 汇报顺序第 1 项改成：Start with the words "Counts:", then the counts: …

别的语言下，这两个词按 D3 译出。代价：汇报第一行以固定的词开头。

**第二轮之后撤回。** 第二轮 3 次英文缩短运行里，2 次以 "Counts:" 开头；1 次仍把同一句叙述放在最前面，"not even a line on what you ran or found" 没有拦住。标题这种形式没有再出现，但样本只有 3 次。指定 `--language Chinese` 的那次，开头的词留成了英文 "Counts："，没有译出；第一轮中文汇报的同一位置是「统计」。D5 要挡的叙述前缀两轮都是 1/3，没有改善，却在指定语言时带来了新的缺陷，所以撤回。撤回后 skill 与契约测试和第 3 个 commit 之后逐字相同。汇报前多一句叙述的情形记为未解决。

### D4 契约测试

- Language 段两份逐字相同：一份开 Step 1，一份在取各节的 `jq` 块之后、紧挨在汇报说明之前；第 2–6 步开头各一行指回它；选项那句在；
- 一组已知的坏副本（缺段、改字、挪到取数之前、少一步的指回行、选项改成「按请求」）都被查出；
- D2 的规则、D3 的三句与第 8 项原文都在，指向 chat 的旧规则已经不在；
- skill 里没有汉字。

## Risks / Trade-offs

- 只改提示词，没有确定性的地板。代价由 O3、O4 量出。
- 汇报的首尾与「没有自己的结论」只能靠文本判据量，模型换个说法（如 "Overview"）判据可能漏看。判据按标题与首尾行检查，被判为可疑的照记原文。
- 指定 `--language` 时，进度说明大概率仍是英文（hotspots 两轮的结果），这里只量汇报。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：一个公开 Java 示例仓库（162 个提交、1775 个函数候选）的 APFS 克隆。`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实由 `lazy-analyze.mjs` 事先建好，克隆里检查为新鲜；
- 缩短运行：用基线那次运行留下的产物（第 1–5 步的结果），附加系统提示「第 1–5 步已跑完，只做第 6 步」，工具限 Bash、Read、Write；
- 完整运行：不加提示、不限工具，从第 1 步跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**汇报的判据（不指定语言）：**
- 代码之外汉字与假名为 0；
- 第一行非空行讲计数：有 "count"（不分大小写）或候选数；
- 最后一行非空行有 `/excavator-chat`；
- 没有标题是结论、摘要一类（Conclusion、Summary、Key findings、TL;DR、Overview）。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉第 1 步的 Language 段；
  - 改掉第 6 步那份的一个词；
  - 把第 6 步那份挪到取各节的 `jq` 块之前；
  - 删掉第 2 步开头的指回行；
  - 选项改成「不指定时按请求的语言」；
  - 删掉 D2 的 "in `$LANGUAGE`"；
  - 删掉 D3 的首尾那句；
  - 删掉 D3 的项目文件那句；
  - 删掉 D3 的译出那句；
  - 删掉第 8 项；
  - skill 里加一个汉字。
- **O2 基线：** 已在提案前跑过，见 Context。
- **O3 缩短运行，不指定语言：** 3 次，每次上限 $1。每次汇报都满足判据，主会话写给用户的每段文字（去掉代码后）汉字与假名为 0。
- **O4 完整运行，不指定语言：** 1 次，上限 $3。汇报满足判据；主会话每段文字汉字与假名为 0；产物里每条入口决定的理由汉字与假名为 0。
- **O5 缩短运行，`--language Chinese`：** 1 次，上限 $1。要满足：
  - 汇报的每个标题行都有汉字；
  - "its name occurs nowhere else; needs confirmation" 与 "signs of use found" 原文都不出现；
  - 最后一行非空行有 `/excavator-chat`。

  进度说明的语言照记，不作判据。
- **O6 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O7 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0；分支改动里汉字为 0。
- **花费：** 含基线合计不超过 $7，超出即停，照记。
