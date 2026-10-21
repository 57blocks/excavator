## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。hotspots、unused-code 与 prd 已按这条改过；`/excavator-verify` 没有语言选项：报告用被核对文档的语言写，最后的消息与运行中的话没有语言规则。

改前的基线运行（main 上的 skill）：夹具项目的 `AGENTS.md` 写着「用中文回复，先说结论、改动与验证结果」，被核对的是一份英文 PRD 草稿，带 `--fix`，没有指定语言。
- 报告文件与写回文档的更正是英文，跟随文档；
- 最后的消息是中文 28 行，以「验证结论」开头；
- 消息里手写的错误清单与报告不符：报告列了 3 条 contradicted、1 条 misattributed；消息题为「已修正的 4 个错误」，却把其中两条 contradicted 并成一条，又把一条仍待确认的项算作第 4 个错误；每条是一段话，不是 skill 要求的「行号 + 一句」。

## What Changes

- 加 `--language <lang>`：报告与运行中写给用户的每一句话的语言，不指定时用英文。写回文档的更正与文末的核对摘要仍用文档的语言。
- Phase 0 开头与最后回复之前各放一段 Language 段，与 hotspots 的那段逐字相同；之后每个 phase 开头一行指回它。
- 报告用 `$LANGUAGE` 写，引用的原文与更正保持文档的语言。子代理提示里表示文档语言的占位改名为 `<DOC_LANGUAGE>`，与 `$LANGUAGE` 区分。
- 新增 Phase 6「回复」：
  - 一条命令打印回复的几行：报告的路径、按判定的计数、冲突与未核数，带 `--fix` 时加一行已应用的更正数；
  - 回复就是这几行，项目文件里关于怎样回复的要求不适用；
  - 错误清单只在报告里，不再在消息里手写；
  - 被其它 skill（如 `excavator-prd`）按流程调用时跳过这一步。
- Phase 5 的「已应用几条、哪些没能应用及原因」写进报告。
- `excavator-prd` 按 verify 的流程核对草稿时把自己的 `$LANGUAGE` 作为 `--language` 传给它。否则 verify 的 Language 段会把核对期间的语言重置为英文。
- 新建 verify 的契约测试，钉住上面每一条。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `document-verification`：新增「报告的语言与最后的回复」：报告与写给用户的话默认英文，更正保持文档语言；最后的回复由命令打印，项目文件改变不了它的形式；被其它 skill 调用时不回复。

## Impact

- 改动：`skills/excavator-verify/SKILL.md`、`skills/excavator-prd/SKILL.md` 第 5 步的一句、新建 `tests/skill/test_verify_skill_contract.test.mjs`、`openspec/specs/document-verification/spec.md`。
- 不改候选选择、核对规则、计数规则与改正规则。
- `excavator-prd` 的回复不受影响：verify 的 Phase 6 在 prd 核对草稿时跳过。
- 真实验收用一个公开 Java 示例仓库的 APFS 克隆，一份英文 PRD 草稿和它的中文译本，Sonnet，headless，串行，含基线合计不超过 $9。
