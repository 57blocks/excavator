## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。`/excavator-hotspots` 刚按这条改过；`/excavator-unused-code` 还没有语言选项，也没有说项目文件改变不了语言。

`/excavator-unused-code` 不写报告文件，第 6 步的汇报就是最后的回复。改前的基线运行（main 上的 skill）里，夹具项目的 `AGENTS.md` 写着「用中文回复，先说结论、改动与验证结果」，调用没有指定语言：
- 汇报整份是中文，68 行，739 个汉字；
- 汇报的顺序被项目文件改了：第一节是「结论」，里面有对项目的介绍和对计数原因的解释，都不是产物里的字段，计数排到了第二节；
- 主会话 8 段写给用户的话里有 3 段是中文。

## What Changes

- 加 `--language <lang>` 选项：汇报、入口决定的理由与运行中写给用户的每一句话的语言，不指定时用英文。
- 第 1 步开头与第 6 步汇报之前各放一段逐字相同的 Language 段，与 hotspots 的那段相同；第 2–6 步开头各一行指回它。
- 第 4 步：每个入口决定的 `reason` 用 `$LANGUAGE` 写。
- 第 6 步：
  - skill 给定的固定措辞在别的语言下译出；
  - 汇报就是回复：以计数开头，以指向 `/excavator-chat` 的固定一句结尾，前后都不写别的，不加自己的摘要或结论；
  - 项目文件里关于怎样回复的要求不适用；
  - 原来规则里「指向 `/excavator-chat`」那条，改为汇报顺序里的第 8 项。
- 契约测试钉住上面每一条。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `unused-code`：「产物、新鲜度与查询」里 skill 的汇报加语言规则；汇报的顺序与首尾不因项目文件里关于回复形式的要求而改变。

## Impact

- 改动：`skills/excavator-unused-code/SKILL.md`、`tests/skill/test_unused_code_skill_contract.test.mjs`、`openspec/specs/unused-code/spec.md`。
- 不改脚本、产物、可信度规则与第 3 步判断入口的规则；不改 `/excavator-chat` 的未使用代码问答。
- 真实验收用一个公开 Java 示例仓库的 APFS 克隆（事实事先建好），Sonnet，headless，串行，含基线合计不超过 $7。
