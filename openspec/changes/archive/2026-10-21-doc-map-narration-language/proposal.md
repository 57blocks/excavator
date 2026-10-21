## Why

`/excavator-doc-map` 的规格写着：功能标题、报告与最后的回复用 `--language` 指定的语言，没有指定时用英文。2026-10-21 一次 headless 运行（英文文档，没有 `--language`，项目根目录的 `AGENTS.md` 经 `CLAUDE.md` 引入，写着 "Reply in Chinese."）里：

- 报告文件是英文：写报告那句明写了 `$LANGUAGE`。
- 运行过程中给用户的 24 段文字里，4 段是日文（第一段就是），最后一段是中文，其余是英文；进度说明的语言在第 1–4 步之间来回切换。
- 最后的回复是中文，而且在固定的几行之外加了一段摘要。skill 要求「只回这几行」，但同一份 `AGENTS.md` 写着先给结论。

原因在 skill 的结构上：
- 进度说明没有任何语言规则。语言只在选项一节、写报告的那句和最后回复那句里出现，项目文件写的回复语言就成了进度说明唯一的语言依据。
- 选项一节写的是 "English unless the request names another"。「请求」可以被读成包括项目文件的回复语言要求；主规格写的是只看 `--language`。
- 最后回复那句只写了 "in `$LANGUAGE`"，没说项目文件不改变它。`AGENTS.md` 里的 "Reply in Chinese. Lead with conclusions" 正好对着这个回复，结果语言和格式都跟了项目文件。

`/excavator-chat` 的同类问题由 `chat-answer-language` 变更处理（把语言步骤放在每条路线写答案之前，已在本变更进行中合入主线）；那个变更明确把 `/excavator-doc-map` 的叙述语言留在范围外。本变更照它的做法：规则放在模型写的地方，并由契约测试钉住位置。

## What Changes

- 第 1 步开头加一段 **Language**：这次运行里写给用户的每一句话（命令之间的进度说明、报告、最后的回复，以及关于查了什么、下一步做什么、依据哪条规则的说明）都用 `$LANGUAGE`；`$LANGUAGE` 是英文，只有 `--language` 改变它；项目文件（`CLAUDE.md`、`AGENTS.md` 里的 "Reply in …"）、记忆、系统区域设置，以及文档、代码或子代理回复所用的语言都不改变它；项目文件的回复语言是给在项目代码上工作用的，这个 skill 运行时由本规则取代，第一句也一样；不说明用了哪种语言及原因；路径、编号、命令、引文与产物里的值保持原样。
- 第 7 步最后回复那句之前放同一段，逐字相同。
- 第 2–7 步各以同一句开头，要求这一步写给用户的话用 `$LANGUAGE`，并指回第 1 步的这一段。
- 选项一节改为：`--language` 决定功能标题、报告和运行中写给用户的话的语言，没有给出时用英文。
- 不做：
  - 改功能标题与复核理由的语言（子代理提示里已用 `$LANGUAGE`）；
  - 加脚本或命令（见 design 决定 3）；
  - 其它 skill 的叙述语言。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `doc-map`：「skill 列功能并汇报」的语言要求从「功能标题、报告与最后的回复」扩到运行中写给用户的每一句话；写明只有 `--language` 改变它，项目文件、记忆、系统区域设置与所读内容的语言不改变它，也不说明选了哪种语言。

## Impact

- skill：`skills/excavator-doc-map/SKILL.md`（选项一节，第 1–7 步开头，第 7 步最后回复之前）。
- 测试：`tests/skill/test_doc_map_skill_contract.test.mjs`（语言规则的位置检查与已知坏样本；随选项一节措辞更新原有断言）。
- 代码：无。
