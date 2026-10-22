## Context

`/excavator-diff` 有七步指令，没有选项。第 7 步列了分析要讲的四方面（改了什么、影响什么、涉及哪些层、风险），外加一句「建议要仔细审什么」，没有说回复的形式。基线见 proposal：分析是中文，以项目文件要的「## 结论」开头。

与 explain 相同：用户要的就是分析本身，几十行内容没法由一条命令打印，写成文件再给路径又把答案藏了起来。所以这里固定的是回复的结构，而不是它的文字。explain 的同一做法在另一个变更里（explain-reply-language）。

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

### D2 分析就是回复，用五个固定标题

第 7 步改为：

> 7. **Write the analysis.** The analysis is the reply. Write it in `$LANGUAGE` under these five `##` headings, in this order:
>    - **Changed Components**: what was directly modified (with summaries from matched nodes)
>    - **Affected Components**: what might be impacted (from 1-hop edges)
>    - **Affected Layers**: which architectural layers are touched and cross-layer concerns
>    - **Risk Assessment**: based on node `complexity` values, number of cross-layer edges, and blast radius (number of affected components)
>    - **Review Focus**: what to review carefully and any potential issues
>
>    Write nothing before the first heading or after the last section's text. In a language other than English, write the headings translated; code identifiers and paths stay as they are. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.

前四个标题就是改前第 7 步的四方面；改前那句「建议要仔细审什么」原来没有标题，成为第五节。

**为什么固定标题：** 项目文件的「先说结论」能插进来，是因为回复没有形式。固定的标题加上「第一个标题之前不写」，开头只能是第一个标题，也能逐次核对。

**备选：** 把分析写进 `.excavator/` 再回复路径。否决：diff 是看完改动立刻要读的，回复只给路径要用户多打开一个文件。

### D3 提醒写在第一个标题下

第 3 步的 `stale` 与 `missing` 两条改为写在分析第一个标题下的第一行。「第一个标题之前不写」之后，原来的「分析之前提醒」与它冲突。

### D4 契约测试（新建）

- frontmatter 的名字与 `argument-hint`；skill 里没有汉字；
- Language 段与 hotspots 的逐字相同，出现两次：一份开 `## Instructions`，一份紧挨第 7 步之前、在第 6 步之后；
- 选项那句在；第 3 步的命令块设 `LANGUAGE`；
- 一组已知的坏副本都被查出：缺段、不在开头、自成一节、不在第 7 步之前、挪到第 6 步之前、挪到最后、改字、选项改成跟随项目；
- 第 7 步的开头句在，列出的标题依次是那五个，skill 以第 7 步的说明结尾；
- D3 两句在，改前的「warn before impact analysis」已不在。

## Risks / Trade-offs

- 只改提示词，没有确定性的核对；代价由 O3、O4 量出。回复的形式靠模型遵守。
- 改动很小时也要写满五节；某节没有内容时模型会写一句说明。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：前几个语言变更用过的公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实事先建好，克隆里检查为新鲜，图谱没有层记录；
- 改动：每份克隆里把基线用的那个 Java 常量的默认值改掉，不提交；
- 完整运行：不加提示、不限工具，从头跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**回复的判据：**
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
  - 删掉「第一个标题之前不写」那句；
  - 删掉「项目文件的回复要求不适用」那句；
  - 删掉译出那句；
  - 删掉一个标题，或调换两个标题的顺序；
  - 恢复「warn before impact analysis」；
  - skill 里加一个汉字。
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
