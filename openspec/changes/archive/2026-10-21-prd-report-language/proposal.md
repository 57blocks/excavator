## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。`/excavator-hotspots` 与 `/excavator-unused-code` 已按这条改过；`/excavator-prd` 的 `--language` 不指定时「跟随代码库的主要语言或用户请求的语言」，也没有一句管运行中写给用户的话。

改前的基线运行（main 上的 skill）里，夹具项目的 `AGENTS.md` 写着「用中文回复，先说结论、改动与验证结果」。调用没有指定语言，用 `--scope` 限定在一个小模块：
- PRD 正文是英文（代码库是英文）；
- Phase 1 打印给用户的流程清单是中文，18 行里 15 行有汉字；
- 最后的回复是中文，以「结论」开头，是模型自己挑选的摘要（说 7 条被改正，列出 4 条），结尾反问要不要 commit；
- 本应「提议保存」，模型没有问就把 PRD 写进了项目的 `docs/`。

## What Changes

- `--language <lang>`：PRD 与运行中写给用户的每一句话的语言，不指定时用英文。去掉「跟随代码库语言或请求语言」。
- Phase 0 开头与最后回复之前各放一段 Language 段，与 hotspots 的那段逐字相同；Phase 1–4 开头各一行指回它。Phase 3 里写作语言的说法改为 `$LANGUAGE`。
- Phase 4 第 6 步改为「保存与回复」：
  - PRD 留在第 5 步写下的位置，保存进项目仍是提议；
  - 一条命令打印回复的几行：PRD 的路径、第 1、2、4、5 步的计数、保存的提议；
  - 回复就是这几行，前后都不写别的；项目文件里关于怎样回复的要求不适用；
  - 换了语言时，这几行的文字译出，路径与数字不变。
- 新建 prd 的契约测试，钉住上面每一条。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `prd-generation`：输出语言不指定时用英文；新增「写给用户的话与最后的回复」：运行中的语言规则，最后的回复由命令打印、项目文件改变不了它的形式，保存仍是提议。

## Impact

- 改动：`skills/excavator-prd/SKILL.md`、新建 `tests/skill/test_prd_skill_contract.test.mjs`、`openspec/specs/prd-generation/spec.md`。
- 不改流程清单、写作规则、核对流程（`excavator-verify` 的语言在下一个变更里处理）。
- 真实验收用一个公开 Java 示例仓库的 APFS 克隆，`--scope` 限定在一个小模块，Sonnet，headless，串行，含基线合计不超过 $9。
