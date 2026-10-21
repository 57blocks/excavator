## Context

起因见 proposal.md。现状：
- 选项一节：`--language <lang>` 是功能标题与报告的语言，"English unless the request names another"，文档本身的语言不改变它。
- 第 1 步的 bash 里有 `LANGUAGE="English"   # or the --language value`。
- 第 2 步、第 5 步的子代理提示用 `<language>` / `$LANGUAGE` 写功能标题与复核理由。
- 第 7 步写报告那句是 "Write the report to `$DATA/doc-map-report.md` in `$LANGUAGE`"，最后一段是 "Then reply in `$LANGUAGE` with these lines and nothing else … Do not summarize the report or add notes."
- 运行中命令之间的进度说明没有任何语言规则。

失败的那次运行里，报告文件是英文（写报告那句有 `$LANGUAGE`）；进度说明第 1 段就是日文，第 1–4 步之间来回切换；最后的回复是中文，并多了一段摘要。项目 `AGENTS.md` 写着 "Reply in Chinese. Lead with conclusions, changes, and verification results."

## Goals / Non-Goals

**Goals:**
- 运行中写给用户的每一句话、报告和最后的回复都用 `$LANGUAGE`；没有 `--language` 时是英文，项目文件、记忆、系统区域设置、所读内容的语言都改变不了它。
- 规则写在模型写这些话的步骤里，由契约测试钉住位置。

**Non-Goals:**
- 改功能标题与复核理由的语言规则；改其它 skill；加脚本。

## Decisions

**1. 同一段 Language 文字放两处，其余各步开头一句指回它。**
- 整段文字：

  > **Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory, the system locale and the language of the documents, the code or a subagent's reply do not change it. Never say which language you write in or why. Paths, ids, commands, quotes and the product's values stay as they are.

- 第一处在第 1 步开头、第 1 项之前：失败运行的第一段进度说明写在第一条命令之前，就已经是日文。
- 第二处在第 7 步最后回复那句之前，紧挨着它：失败运行的最后回复跟着 `AGENTS.md` 换了语言、加了摘要，而写报告那句（有 `$LANGUAGE`）没有出错。最后回复那句保留原措辞。
- 第 2–7 步各以同一句开头："Write what you tell the user during this step in `$LANGUAGE`, as **Language** in Step 1 says." 失败运行正是在第 2–4 步之间漂移，离第 1 步开头 30–90 行。
- 两处整段逐字相同，由契约测试比对。
- 备选：
  - 单独一节写语言规则：规则离写的地方远。`chat-answer-language` 的诊断里，离写答案远的语言规则在 20 次运行里一次都没被执行。不采用。
  - 每一步都放整段：七段各约 80 个词，规则本身被淹没在重复里。不采用。
  - 只放第 1 步：第 2–7 步的进度说明离它 30–200 行，最后的回复离它最远，而失败运行最后一段是错得最多的。不采用。
- 代价：skill 多 2 段、6 句。

**2. 只有 `--language` 改变语言。**
- 选项一节原写 "English unless the request names another"，与主规格「用 `--language` 指定的语言，没有指定时用英文」不一致；「请求」可被读成包含项目文件的回复语言要求。改为只看 `--language`，与仓库里报告类 skill 默认英文、`--language` 才换的约定一致。
- 代价：用户在请求里用自然语言写「用中文」、却不带 `--language` 时，得到英文。要别的语言就传 `--language`。

**3. 不加脚本或命令。**
- AI-first 闸：`/excavator-chat` 加了命令行入口，是因为回答语言要从问题判断三个信号再按优先序选，而 skill 原有的选择调用在 20 次运行里一次都没被执行；doc-map 的语言是参数值，第 1 步的 bash 已经把它赋给 `LANGUAGE`，没有要判断的东西。缺的是「进度说明也算」「项目文件不算」这两句话放在写的地方，改 skill 措辞即可。
- 运行记录里可核对的痕迹是第 1 步那条命令里的 `LANGUAGE=` 赋值。

**4. 契约测试用一个检查函数，先在已知坏样本上证明它看得见。**
- `languageRuleProblems(text)` 对一份 skill 文本返回问题清单：整段恰好出现两次且逐字相同；第一处在第 1 步、第 1 项之前；第二处在第 7 步、建议检查的命令之后、最后回复那句之前；第 2–7 步的第一行是那一句；选项一节写明只看 `--language`。
- 真实 skill 上返回空；已知坏样本上各返回至少一条。

## 验收 oracle（动手前写定）

1. 契约测试（`pnpm test` 全绿）：
   - `languageRuleProblems` 在改后的 skill 上返回空。
   - 先验装置：改 skill 之前，同一函数在主线 skill 上报错（记下条数）；改后在以下已知坏样本上各报错：删掉第 1 步那段；把两段挪成选项一节之后的单独一节；删掉第 4 步开头那句；把第 7 步那段挪到最后回复那句之后；改动其中一段的措辞（删掉 "memory, "）；把第 1 步那段挪到第 1 项的命令之后；选项一节改回 "unless the request names another"。
   - 原有的选项一节断言随新措辞更新。
2. 全量门：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test && node scripts/check-refs.mjs && openspec validate --all --strict`，在独立检出上逐个 commit 跑。
3. 真实运行（headless，`--model sonnet`，`--plugin-dir` 指向本分支，顺序执行，总花费 < $1）。夹具：公开仓库 go-clean-arch 的副本（HEAD `e06c6d0`），确定性生成的 Lazy 事实；项目外一个文档目录，一份英文用例文档（两条编号用例）；根目录 `CLAUDE.md` 引入 `AGENTS.md`，`AGENTS.md` 写 "Reply in Chinese."，调用不带 `--language`。
   - 改后一次（必做）。判据：主会话写给用户的每段文字（不含子代理的消息），去掉代码块与行内代码后，汉字与假名为 0；报告文件汉字与假名为 0；最后的回复只有固定的几行（报告路径、计数的前两行、复核那行、计数的第一行、`advice check: 0 lines`），没有摘要。
   - 基线一次（主线 skill，同一夹具）：只在第一次花费不超过 $0.45 时做，用来看夹具能否复现漂移；没复现就照记，并说明这次真实运行只能证明改后没有漂移，不能证明改动消除了它。
