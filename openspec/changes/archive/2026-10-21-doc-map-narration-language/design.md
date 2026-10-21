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

  > **Language.** Write everything you tell the user during this run in `$LANGUAGE`: each line between commands, the report and the final reply, including any remark on what was checked, what comes next or which rule was followed. `$LANGUAGE` is English unless `--language` gives another. Project files (`CLAUDE.md`, an `AGENTS.md` line such as "Reply in <language>"), memory, the system locale and the language of the documents, the code or a subagent's reply do not change it. A project file's rule to reply in another language is for work on the project's code; while this skill runs, this rule takes its place for every line you write, the first one included. Never say which language you write in or why. Paths, ids, commands, quotes and the product's values stay as they are.

- "A project file's rule … the first one included." 一句是验收中补的：第一版只列出项目文件不改变语言，没说两者冲突时谁让谁。项目 `CLAUDE.md` 以覆盖默认行为的说明进入上下文，skill 是作为用户消息展开的；第 2 次运行（见验收结果）里，模型知道 `$LANGUAGE` 是英文，却仍用中文写了一句说明，内容正是「`AGENTS.md` 的语言设置不改变本次运行的语言」。补的这句写明项目文件的回复语言是给在项目代码上工作用的，这个 skill 运行时由本规则取代，第一句也一样。

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

## 验收结果

**契约测试与全量门。**
- 先验装置：改 skill 之前，`languageRuleProblems` 在主线 skill 上报出 10 条：选项一节没写只看 `--language`；整段出现 0 次；第 1 步没以整段开头；第 2–7 步各没以那一句开头（6 条）；第 7 步最后回复之前没有整段。
- 改后在真实 skill 上返回空；在 8 份已知坏样本上各报出预期的问题：没有任何语言规则（等同改前，10 条）；删掉第 1 步那段；挪成单独一节；删掉第 4 步那句；第 7 步那段挪到最后回复之后；改动一段措辞；第 1 步那段挪到第 1 项的命令之后；选项一节改回 "unless the request names another"。
- 装置本身先出过一次错：第一版检查在第 7 步那段挪到最后回复之后时不报错（两处之间的文字为空就算通过，没检查先后）。「挪到最后回复之后」这份坏样本把它抓了出来，改为要求整段在最后回复那句之前。
- 本分支在等待期间变基到主线 `863f7a19`（`chat-answer-language` 已合入），变基没有冲突。全量门（`pnpm install --frozen-lockfile && pnpm -r build && pnpm test && node scripts/check-refs.mjs && openspec validate --all --strict`）在独立检出上逐个 commit 跑：
  - 第 1 步 commit（`daa83830`，只动 `openspec/`）：`openspec validate --all --strict` 45 项通过；
  - 第 2 步 commit，补措辞前（`fc677ef3`）：151 个测试文件，4078 例通过、4 例跳过；`check-refs` 通过；`openspec validate` 45 项通过；
  - 第 2 步 commit，补措辞后（`e8ce483d`，补的一句并入这个 commit）：同上，151 个测试文件，4078 例通过、4 例跳过，`check-refs` 与 `openspec validate`（45 项）通过。
- 本分支在 skill 与测试里新增的中文字符为 0。

**真实运行**（headless Sonnet，`--plugin-dir` 指向本分支对应 commit 的已构建检出，顺序执行）。
- 夹具：公开仓库 go-clean-arch 的副本（HEAD `e06c6d0`），确定性生成的 Lazy 事实（`consumer-freshness` 为 `fresh`）；项目外一个文档目录，一份英文用例文档；根目录 `CLAUDE.md` 引入 `AGENTS.md`，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."；调用不带 `--language`。
- 判据按 oracle，三项分开判：主会话的进度说明（不含子代理消息，去掉代码后数汉字与假名）、报告文件、最后的回复。

| 运行 | skill | 环境与输入 | 进度说明 | 报告 | 最后的回复 | 花费 |
|---|---|---|---|---|---|---|
| 1 | 补措辞前（`fc677ef3`） | 完整环境（用户插件与 MCP 都在）；两条用例；从第 1 步跑；预算上限 $0.60 | 4 段，全英文，0 汉字/假名（第 1–4 步） | 未到 | 未到：在第 4 步撞预算上限 | $0.606 |
| 2 | 补措辞前（`fc677ef3`） | 只读项目设置、不加载 MCP；产物由 skill 自己的命令确定性建好（两条用例），附加系统提示「第 1–6 步已跑完，只做第 7 步」；上限 $0.35 | 1 段，中文，说明 `$LANGUAGE` 是英文、`AGENTS.md` 不改变本次运行的语言 | 英文，0 汉字/假名 | 未到：撞预算上限 | $0.368 |
| 3 | 补措辞后（`e8ce483d`） | 同运行 2，另把工具限为 Bash、Read、Write；一条用例；上限 $0.45 | 3 段，全英文，没有关于语言的说明 | 英文，0 汉字/假名 | 英文，固定的几行都在、照查询原样；但前面多了一句 "The advice check printed 0 lines. Report written to `.excavator/doc-map-report.md`." | $0.244 |

- 合计 $1.218。原定上限 $1；运行 2 之后剩余不够再跑一次，经发起本变更的会话同意，为运行 3 追加至多 $0.45（合计约 $1.42），并约定只跑这一次、结果照记。
- 运行 1 的第 1 条命令里有 `LANGUAGE="English"`，运行 3 同样有。
- 基线没跑：oracle 要求第一次花费不超过 $0.45 才跑，运行 1 是 $0.606。所以这些运行不能证明夹具能复现原来的漂移；原来的漂移只有那一次私有语料上的运行记录（报告英文，进度说明 4 段日文，最后回复中文并加了摘要）。
- 结论：
  - 进度说明与报告：补措辞后的一次运行（运行 3）通过；补措辞前的运行 1 在第 1–4 步通过，运行 2 不通过，不通过的形态与 `chat-answer-language` 验收中 A4 那次相同（关于规则的说明漏成项目文件的语言）。
  - 最后的回复：语言通过；格式没有完全通过，固定的几行之前多了一句英文说明（不是报告摘要）。「只回这几行」这条早于本变更，本变更没有改它；按约定不再迭代，记为未解决。
- 没覆盖的：
  - 补措辞后没有从第 1 步跑完的完整运行；运行 2、3 是只做第 7 步的缩短运行，环境去掉了用户插件与 MCP，并多了一句英文附加系统提示，这句提示本身可能把语言往英文推；
  - `--language` 指定其它语言的情形只有契约测试，没有真实运行；
  - 子代理写的功能标题与复核理由的语言不在本变更范围内。
