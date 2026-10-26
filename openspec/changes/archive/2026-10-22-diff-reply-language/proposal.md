## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。hotspots、unused-code、prd、verify 已按这条改过，onboard 与 explain 正在改。`/excavator-diff` 没有语言选项，第 7 步只列了分析要讲的几方面，没有说回复是什么形式。

改前的基线运行（main 上的 skill）：
- 夹具项目的 `AGENTS.md` 写着「Reply in Chinese. Lead with conclusions, changes, and verification results.」；
- 工作区有一处未提交的改动（一个 Java 常量的默认值），调用没有指定语言；
- $0.31，10 轮，约 1.5 分钟。

结果：
- **进度说明：** 1 段，英文；
- **最后的回复（即分析本身）：** 中文，37 行。以「## 结论」开头，结论里先给风险等级、再交代图谱是新鲜的；之后是「变更内容」「受影响组件」「架构层」「风险评估」。
- 分析的语言与开头都由项目文件决定，而不是 skill。

## What Changes

- 加 `--language <lang>`：分析与运行中写给用户的每一句话的语言，不指定时用英文。
- 指令开头与第 7 步之前各放一段 Language 段，与 hotspots 的那段逐字相同。
- 第 7 步：分析用五个固定的 `##` 标题按顺序（Changed Components、Affected Components、Affected Layers、Risk Assessment、Review Focus）写到 `.excavator/diff-analysis.md`，文件以第一个标题开头、以最后一节结尾；其它语言下标题译出。
- 第 8 步：最后一条命令打印这个文件，回复就是它打印的内容，此外不写任何文字；项目文件里关于怎样回复的要求不适用。
- 图谱过期或缺清单时的提醒写在第一个标题下的第一行，不再写在分析之前。
- 新建 diff 的契约测试，钉住上面每一条。

## Capabilities

### New Capabilities

- `diff-analysis`：改动分析的语言与回复的形式。

### Modified Capabilities

无。

## Impact

- 改动：`skills/excavator-diff/SKILL.md`、新建 `tests/skill/test_diff_skill_contract.test.mjs`、新建 `openspec/specs/diff-analysis/spec.md`。
- 不改取改动文件与读图谱的第 2–6 步；五个标题就是改前第 7 步的四方面加「要仔细审的地方」。
- 分析仍是回复本身：回复是打印出来的整份分析，不是路径。文件在 Excavator 的数据目录里，下次运行覆盖。
- 真实验收用前几个语言变更用过的公开 Java 示例仓库的 APFS 克隆，Sonnet，headless，串行，含基线合计不超过 $4。
