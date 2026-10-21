## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。`/excavator-chat` 与 `/excavator-doc-map` 已经按真实运行守住了这一条，`/excavator-hotspots` 还没有：它没有语言选项，也没有说项目文件改变不了语言。

改前的基线运行（main 上的 skill）复现了问题。夹具项目的 `AGENTS.md` 写着「用中文回复，先说结论、改动与验证结果」，调用没有指定语言：
- 报告整份是中文：239 行里 38 行有汉字，标题、小节名与正文都是中文；
- 最后的回复是中文，固定的两行前面多一句「报告已写入」，后面又加一句指向 `/excavator-chat`；
- 主会话 6 段写给用户的话里 1 段是中文。

最后回复的形式与 `/excavator-doc-map` 修过的缺陷相同：自检是最后一条命令，它的结果播报与回复并成了最后一条消息。

## What Changes

- 加 `--language <lang>` 选项：报告与运行中写给用户的每一句话的语言，不指定时用英文。
- 第 1 步开头与第 4 步最后回复之前各放一段逐字相同的 Language 段，第 2–4 步开头各一行指回它。这一段写明：
  - 项目文件、记忆与系统区域设置都不改变语言；
  - 项目文件里的回复语言要求是给在项目代码上工作用的，本 skill 运行时由这条规则取代。
- 报告用 `$LANGUAGE` 写，第 4 步给定的固定措辞在别的语言下译出。
- 最后回复改为由一条命令打印两行：报告路径、`advice check: 0 lines`。回复就是这两行，项目文件里关于怎样回复的要求不适用。
- 原来回复里指向 `/excavator-chat` 的那句挪到报告末尾，随报告用 `$LANGUAGE`。
- 契约测试钉住上面每一条，并在夹具产物上运行回复命令。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-hotspots`：「产物、新鲜度与查询」里 skill 的汇报加语言规则；最后的回复只有两行，项目文件里关于回复形式的要求不改变它。

## Impact

- 改动：`skills/excavator-hotspots/SKILL.md`、`tests/skill/test_hotspots_skill_contract.test.mjs`、`openspec/specs/change-hotspots/spec.md`。
- 不改脚本、产物与查询；不改 `/excavator-chat` 的改动历史问答。
- 真实验收用一个公开 Java 示例仓库的 APFS 克隆（162 个提交），Sonnet，headless，串行，合计不超过 $5。
