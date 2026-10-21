## Context

`/excavator-verify` 没有语言选项。Phase 0 记下文档的语言，「更正用这种语言与风格写」；Phase 3 报告「用文档的语言」写，结尾一句「In the final message, give the counts and the errors list (line + one-line summary each).」；Phase 5 在文末追加核对摘要，标题用文档的语言，最后一句「Report how many entries were applied, and list any correction you could not apply with the reason.」。运行中写给用户的话没有规则。verify 没有契约测试。

`excavator-prd` 的 Phase 4 第 5 步按 verify 的流程核对草稿（`--fix`），再按自己的格式报告计数。

基线运行（main 上的 skill，提案前跑过一次）：
- 项目：一个公开 Java 示例仓库的 APFS 克隆，`AGENTS.md` 写着 "Reply in Chinese. Lead with conclusions, changes, and verification results."；
- 文档：prd 基线写出的一份英文 PRD 草稿，345 行，放在项目之外；
- 调用：带 `--fix`，没有指定语言；
- $1.80，19 轮，约 13 分钟，一个核对子代理与一个一致性子代理。

结果：
- **进度说明：** 7 段，都是英文；
- **报告：** 英文，87 行；
- **文档：** 4 处更正是英文，文末追加了「Verification summary」；
- **最后的回复：** 中文 28 行，以「验证结论」开头，有一张计数表与「已修正的 4 个错误」。报告里有 3 条 contradicted、1 条 misattributed；回复把其中两条并成一条，又把一条仍待确认的项算作第 4 个错误。每条是一段话；
- **项目：** 没有新文件。

hotspots、doc-map 与 prd 的最后回复由一条命令打印，回复就是它的输出。prd 的缩短运行 3 次里 3 次是命令的输出，1 次的提议行被译成中文。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，报告、进度说明与最后的回复是英文，项目文件与文档的语言都改变不了；
- 引用的原文、写回文档的更正与文末的核对摘要用文档的语言；
- 最后的回复只有报告路径与计数几行，项目文件里关于回复形式的要求改变不了；
- prd 按 verify 的流程核对时，语言跟随 prd，verify 不另给回复。

**Non-Goals:**
- 不改候选选择、核对规则、计数规则与改正规则；
- 不改报告的五个部分，只加一节记录 `--fix` 的结果；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里只照记。

## Decisions

### D1 两种语言：`$LANGUAGE` 与 `DOC_LANGUAGE`

`$LANGUAGE` 管写给用户的一切：报告、进度说明、回复。`DOC_LANGUAGE` 是文档自己的语言，管写进文档的文字与引自文档的文字：引用、更正、文末摘要。

**选项与 argument-hint：**
- argument-hint 加 `[--language <lang>]`；
- 选项：

  > `--language <lang>` — the language of the report and everything said to the user during the run; English when it is not given. Quotes and corrections stay in the document's language.

**Language 段：** Phase 0 开头一份，与 hotspots 的那段逐字相同；Phase 6 在回复命令之前一份。Phase 1–6 开头各一行：

> Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

**其它措辞：**
- Phase 0 第 1 步：解析 `--fix`、`--report` 与 `--language` (`$LANGUAGE`: English when it is not given)；
- Phase 0 第 2 步：把文档的语言记为 `DOC_LANGUAGE`，引用、更正与 `--fix` 追加的摘要用 `DOC_LANGUAGE` 及文档的风格，与 `$LANGUAGE` 无关；
- 子代理提示里的 `<LANGUAGE>` 改为 `<DOC_LANGUAGE>`（两处）；
- Phase 2 的冲突更正注明用 `DOC_LANGUAGE`；
- Phase 3：报告用 `$LANGUAGE` 写，引用与更正保持 `DOC_LANGUAGE`，照文档原样；
- Phase 5：摘要标题用 `DOC_LANGUAGE`。

**备选：** 报告继续跟随文档的语言。用户的规则是只有要求时才出现中文报告，所以报告默认英文。引用与更正是文档自己的文字，译了就对不上原文，也没法写回去，所以留在文档的语言。

**代价：** 核对中文文档时，不加 `--language` 得到的是英文报告，里面夹着中文引用。

### D2 Phase 6：一条命令打印回复的几行

删掉 Phase 3 结尾那句「In the final message …」。新增最后一个 phase：

> ## Phase 6 — Reply
>
> Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.
>
> When you follow this procedure for another skill (for example `excavator-prd`), skip this phase: that skill says what to report.
>
> （第二份 Language 段）
>
> Then print the reply's lines with this command, putting in the report's path, the counts from the report's table and, with `--fix`, the corrections applied, the entries that carry a correction and the document's path:
>
> ```bash
> # the reply: where the report is, the counts by verdict and, with --fix, the corrections applied
> printf '%s\n' \
>   "<the report's path>" \
>   "Statements checked: <N> (<V> verified, <X> contradicted, <Y> misattributed, <U> unverifiable)" \
>   "Open items: <M> (<RR> resolved right, <RW> resolved wrong, <S> still open)" \
>   "Cross-section conflicts: <C>; not checked: <K>" \
>   "Corrections applied: <A> of <B>, in <the document's path>"
> ```
>
> Reply with exactly the lines it prints and nothing else. Its first line, the report's path, is the reply's first line: write nothing before, between or after the lines, no word on the errors, the document or what was done, and no summary or notes; the errors are listed in the report. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply. In a language other than English, write the command's words translated; the paths and the numbers stay as they are. Without `--fix`, leave the last line out.

每行以标签开头，避免「1 open items」这类单复数问题。计数与报告的表一一对应：说法类四个判定、未决项三个判定、冲突、未核对；四类判定合计加未决项合计加未核对等于候选总数。

**备选：** 回复里保留「行号 + 一句」的错误清单。基线里模型手写的清单与报告不符（并条、把待确认项算成错误）；报告是成品，清单在报告里有证据与更正。所以回复只给路径与计数。

**代价：** 用户要打开报告才知道哪几句错了。数字由模型填进命令，命令不核对它们。

### D3 `--fix` 的结果写进报告

Phase 5 最后一句改为在报告末尾加一节 **Fix**：应用了几条，没能应用的每一条及原因。回复只给「Corrections applied: A of B」，细节在报告里。

### D4 被 prd 调用时

- verify 的 Phase 6 开头说明：替其它 skill 走这个流程时跳过这一步；
- prd 第 5 步改为「with `--fix`, `--language` set to `$LANGUAGE` and `PROJECT_ROOT` as the project path」。否则 verify 的 Language 段会说 `$LANGUAGE` 是英文（没有 `--language`），在 prd 用别的语言运行时把核对期间的话切回英文。

不改 prd 的回复与它报告计数的格式。

### D5 契约测试（新建）

`tests/skill/test_verify_skill_contract.test.mjs`：
- Phase 0–6 按顺序、标题不变；frontmatter 名字；skill 里没有汉字；
- 选项、argument-hint 与 Phase 0 第 1 步的原文在；`--language` 只出现在这三处；
- `DOC_LANGUAGE` 的几处原文在：Phase 0 第 2 步、子代理提示两处、Phase 2、Phase 3、Phase 5；子代理提示里没有 `<LANGUAGE>`；
- Language 段两份逐字相同，且与 hotspots 的相同：一份开 Phase 0，一份在 Phase 6 跳过说明之后、紧挨回复命令的说明之前；Phase 1–6 开头各一行指回它；
- 一组已知的坏副本都被查出：缺段、改字、挪进 Phase 5、少一个 phase 的指回行、选项改成跟随文档；
- Phase 6 的命令与说明原文在，skill 以它们结尾；Phase 3 没有「In the final message」；Phase 5 以 Fix 一节的说明结尾；
- 把命令里的占位换成样例值后实际运行，打印 5 行，第一行是路径；
- prd 第 5 步把 `$LANGUAGE` 作为 `--language` 传给 verify。

## Risks / Trade-offs

- [只改提示词，回复里的数字没有确定性核对] → O4、O5 人工把回复的数字与报告的表逐格对照。
- [中文文档的报告里夹着中文引用与更正，按汉字数量量不出说明文字的语言] → O5 只对标题与计数表要求 0 个汉字，其余有汉字的行逐行人工判定是不是引用或更正。
- [完整运行贵] → 每种文档只跑一次完整运行，方差靠缩短运行补。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：基线用的那个公开 Java 示例仓库的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，`CLAUDE.md` 引用它；每次运行一份新克隆；
- 英文文档：基线用的那份 345 行英文 PRD 草稿，放在项目之外，每次一份新副本；
- 中文文档：同一份草稿由 Sonnet 译成中文（代码、路径、标识符、`file:line` 与 mermaid 语法保留，345 行），放在项目之外；
- 缩短运行：
  - 文档与基线报告的副本放在项目之外；
  - 附加系统提示：Phase 0–5 已跑完，带 `--fix`，报告在某路径；给出基线报告的计数：说法 27 条（verified 23、contradicted 3、misattributed 1、unverifiable 0），未决项 1 条（still open 1），冲突 0，未核对 0，更正应用 4 条中的 4 条；
  - 要求只做 Phase 6；工具限 Bash、Read、Write；
- 完整运行：不加提示、不限工具，从 Phase 0 跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP。

**回复的判据：**
- 回复与最后一条 Bash 命令的输出逐行相同（去掉行尾空白与末尾空行）；
- 带 `--fix`：5 行，第一行是一个存在的报告文件的路径；
- 缩短运行：第 2–5 行与给出的计数逐字相同（英文时）；
- 项目目录里（`.excavator` 之外）没有新文件。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉 Phase 0 的 Language 段；
  - 改掉 Phase 6 那份的一个词；
  - 把 Phase 6 那份挪进 Phase 5；
  - 删掉 Phase 2 开头的指回行；
  - 选项改成「不指定时跟随文档的语言」；
  - Phase 3 改回「in the document's language」；
  - 子代理提示里的 `<DOC_LANGUAGE>` 改回 `<LANGUAGE>`；
  - 删掉回复命令的更正那一行；
  - 删掉「项目文件的回复要求不适用」那句；
  - 恢复「In the final message, give the counts and the errors list …」；
  - 删掉 Phase 6 的跳过说明；
  - prd 第 5 步去掉 `--language`；
  - skill 里加一个汉字。
- **O2 基线：** 已在提案前跑过，见 Context。
- **O3 缩短运行，英文文档，不指定语言：** 3 次，每次上限 $0.3。每次回复满足判据；回复与主会话写给用户的每段文字（去掉代码后）汉字与假名为 0。
- **O4 完整运行，英文文档，不指定语言：** 1 次，上限 $2.5。满足：
  - 回复满足判据，数字与报告的计数表一致；
  - 主会话每段文字汉字与假名为 0；
  - 报告与文档代码之外汉字与假名为 0；报告末尾有 Fix 一节。
- **O5 完整运行，中文文档，不指定语言：** 1 次，上限 $2.5。满足：
  - 回复满足判据，数字与报告的计数表一致，回复与主会话每段文字汉字与假名为 0；
  - 报告的每个标题与计数表 0 个汉字；报告里其余有汉字的行，汉字都在引用或更正里（逐行人工判定，照记行数）；报告末尾有 Fix 一节；
  - 文档里被更正改过或新增的正文行都有汉字；文末追加的摘要标题有汉字。
- **O6 缩短运行，英文文档，`--language Chinese`：** 1 次，上限 $0.3。满足：
  - 回复与最后一条 Bash 命令的输出逐行相同；
  - 第 2–5 行每行都有汉字，每行的数字与给出的计数依次相同；
  - 第一行的路径与给出的相同。

  进度说明的语言照记，不作判据。
- **O7 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O8 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，三条隐私检查、测试语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
- **花费：** 含基线与夹具翻译合计不超过 $9，超出即停，照记。
