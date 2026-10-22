## Context

`/excavator-onboard` 只有十步指令，没有选项。第 7 步按五节生成指南，第 8–10 步是「Format as clean markdown」「Offer to save the guide to `docs/EXCAVATOR_ONBOARDING.md`」「Suggest the user commit it」。指南放在哪里、回复写什么都没有规则。基线见 proposal：指南是英文，写在 headless 会话的 scratchpad 里；回复是中文，照项目文件的要求先说结论、再列验证。

prd 改过的做法在这里同样适用：回复只有几行，由一条命令打印，模型对上一条命令结果的播报落在命令之前，不会并进回复。hotspots、doc-map 与 prd 的不指定语言的完整运行都是这样过的。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，进度说明、指南与最后的回复都是英文，项目文件改变不了；
- 指南有固定的位置，回复给出它；
- 最后的回复只有路径与保存的提议，项目文件里关于回复形式的要求改变不了；
- 保存进项目仍是提议；
- 指定 `--language` 时，指南与回复的文字用那种语言，路径不变。

**Non-Goals:**
- 不改读图谱的第 3–6 步与指南的五节；
- 不处理图谱没有层与摘要时指南的质量（基线的图谱只有结构事实，模型派了子代理读源码补）；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里照记，不作判据。

## Decisions

### D1 Language 段与 hotspots 的逐字相同

`## Instructions` 开头一份；第 8 步之后、回复命令之前一份。onboard 没有分 phase，不需要指回行。

段落里的 "the report" 在 onboard 里就是指南。

**选项**，加在标题说明之后的 `## Options` 一节：

> `--language <lang>` — the language of the guide and everything said to the user during the run; English when it is not given.

frontmatter 加 `argument-hint: "[--language <lang>]"`。第 2 步解析 `PROJECT_ROOT` 的命令块里加 `LANGUAGE="English"   # or the --language value`，与 hotspots 相同。

### D2 指南写在数据目录

第 7 步改为把指南用 `$LANGUAGE` 写到 `.excavator/onboarding-guide.md`。原来的「Format as clean markdown」并进这一步。

**为什么是数据目录：** hotspots 的报告也写在 `.excavator/`。这是 Excavator 自己的目录，写进去不算改项目；位置固定，回复可以只给路径。prd 写在临时文件里，是因为草稿还要被 verify 改写；onboard 没有这一步。

**备选：** 像基线那样把指南贴进回复。否决：指南近百行，回复的形式就无法固定，项目文件的「先说结论」会插进来。

### D3 保存与回复：一条命令打印两行

第 8 步：

> 8. **Save and reply.** The guide stays in `.excavator/onboarding-guide.md`, Excavator's data directory: copy it to `docs/EXCAVATOR_ONBOARDING.md`, or a path the user gives, only when the user says so.

接着是第二份 Language 段，然后：

> Then print the reply's lines with this command, putting in the guide's path:
>
> ```bash
> # the reply: where the guide is and the offer to save it
> printf '%s\n' \
>   "<the guide's path>" \
>   "To save it in the project, say so: it goes to docs/EXCAVATOR_ONBOARDING.md unless you give another path. Commit it to share it with the team."
> ```
>
> Reply with exactly the lines it prints and nothing else. Its first line, the guide's path, is the reply's first line and the offer to save its last: write nothing before, between or after them, no word on the guide or what was done, and no summary or notes. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. In a language other than English, write the command's words translated; the path stays as it is.

原来的第 9、10 步并进提议那一行。回复里没有计数：onboard 没有自检步骤，没有要报的数。

### D4 过期提醒写进指南

第 2 步 `stale` 一条加「and open the guide with the same note」。回复固定为两行之后，运行中的提醒在交互使用时还看得到，但指南被复制进项目后就丢了；写进指南开头，读指南的人都看得到。`missing` 一条不变。

### D5 契约测试（新建）

- frontmatter 的名字与 `argument-hint`；skill 里没有汉字；
- Language 段与 hotspots 的逐字相同，出现两次：一份开 `## Instructions`，一份在第 7 步之后、紧挨回复命令的说明之前；
- 选项那句在；第 2 步的命令块设 `LANGUAGE`；第 7 步写的是 `$LANGUAGE` 与指南的路径；
- 一组已知的坏副本都被查出：缺段、不在开头、自成一节、不在回复之前、挪到第 7 步之前、挪到回复之后、改字、选项改成跟随项目；
- D3 的第 8 步、命令与说明原文都在，skill 以它们结尾；原来的「Offer to save the guide」「Suggest the user commit it」「Format as clean markdown」已不在；
- 把命令里的占位换成样例路径后实际运行，打印 2 行，第一行是路径；
- D4 那句在。

## Risks / Trade-offs

- 只改提示词，没有确定性的核对；代价由 O3、O4 量出。
- 交互使用时读指南要打开路径。
- `.excavator/` 通常不进版本库，指南留在那里不会被提交；要分享得按提议复制进项目。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：前几个语言变更用过的公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实事先建好，克隆里检查为新鲜，图谱没有层记录；
- 完整运行：不加提示、不限工具，从头跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**回复的判据：**
- 回复与最后一条 Bash 命令的输出逐行相同（去掉行尾空白与首尾空行）；
- 2 行，第一行是这次运行写下的 `.excavator/onboarding-guide.md` 的路径；
- 项目目录里（`.excavator` 之外）没有新文件。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉开头那份 Language 段；
  - 改掉第 8 步之后那份的一个词；
  - 把第 8 步之后那份挪到第 7 步之前；
  - 选项改成「不指定时跟随项目」；
  - 删掉第 2 步的 `LANGUAGE=` 一行；
  - 删掉回复命令的提议那一行；
  - 删掉「项目文件的回复要求不适用」那句；
  - 删掉译出那句；
  - 恢复「Offer to save the guide」；
  - 删掉 D4 那句；
  - skill 里加一个汉字。
- **O2 基线：** 已在提案前跑过，见 proposal。
- **O3 完整运行，不指定语言：** 3 次，每次上限 $1.5。每次：
  - 回复满足判据，第二行是英文的提议；
  - 主会话每段文字（去掉代码后）汉字与假名为 0；
  - 指南文件代码之外汉字与假名为 0。
- **O4 完整运行，`--language Chinese`：** 1 次，上限 $1.5。满足：
  - 回复与最后一条 Bash 命令的输出逐行相同，2 行；
  - 第一行是这次写下的指南的路径，第二行有汉字；
  - 指南代码之外有汉字。

  进度说明的语言照记，不作判据。
- **O5 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
- **花费：** 含基线合计不超过 $6，超出即停，照记。

## 验收记录

- **O1：** 11 个变异都让契约测试变红，做完已还原；还原后 10 个测试全绿。
- **O2：** 见 proposal（$0.92）。
- **作废的一轮：** 第一次跑 O3、O4 时撞上账号的用量上限。第 1 次跑完了（$0.68），但运行环境在回复之后追加了一段用量上限的说明，回复不再与命令输出相同；其余 3 次一启动就被拒，没有花费。这一轮不计，按同样的夹具重跑了 4 次。
- **O3：** 3 次都满足。

  | 次 | 花费 | 轮 | 用时 | 指南行数 | 进度说明 |
  |---|---|---|---|---|---|
  | 1 | $0.55 | 17 | 163 s | 111 | 3 段，英文 |
  | 2 | $0.54 | 19 | 160 s | 96 | 5 段，英文 |
  | 3 | $0.64 | 24 | 204 s | 117 | 5 段，英文 |

  每次：回复与最后一条命令的输出逐行相同，2 行；第一行是这次写下的 `.excavator/onboarding-guide.md` 的绝对路径，第二行是英文的提议；指南代码之外的汉字与假名为 0；项目目录里只新写了这份指南。
- **O4：** 满足。$0.52，21 轮，162 s。回复与最后一条命令的输出逐行相同，2 行；第一行是指南的路径，第二行是译成中文的提议；指南 92 行，代码之外有汉字。进度说明 4 段，都是英文（照记，不作判据）。
- **花费：** 基线 $0.92，作废的一轮 $0.68，重跑 $2.24，合计 $3.84，未超过 $6。
- **O5（本地，2b0f8b42）：** 构建、类型检查、core 1437 个测试、引用检查与 `openspec validate --all --strict` 通过；全量测试 4144 个通过、2 个失败，都在 `tests/benchmark/test_large_repo_benchmark.test.mjs`。那个文件数整机共享临时目录里的条目，当时机器上有别的运行，单独跑它也失败 6 个；本变更不碰它。以 PR 上的 CI gate 为准。
- **O6：** 推送前扫了本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文：隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
