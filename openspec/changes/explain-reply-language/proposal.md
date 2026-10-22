## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。hotspots、unused-code、prd、verify 已按这条改过，onboard 正在改。`/excavator-explain` 没有语言选项，第 8 步只列了解释要讲的几方面，没有说回复是什么形式。

改前的基线运行（main 上的 skill）：
- 夹具项目的 `AGENTS.md` 写着「Reply in Chinese. Lead with conclusions, changes, and verification results.」；
- 解释一个 Java 类，调用没有指定语言；
- $0.36，10 轮，约 1.5 分钟。

结果：
- **进度说明：** 3 段，都是英文；
- **最后的回复（即解释本身）：** 中文，68 行。以「## 结论」开头，并写了「本次只是解释说明，未对代码做任何修改」；第二段交代图谱的新鲜度与摘要为空；之后是编号的「## 1. 在架构中的角色」到「## 5. 值得注意的模式/坑点」。
- 解释的语言与开头都由项目文件决定，而不是 skill。

## What Changes

- 加 `--language <lang>`：解释与运行中写给用户的每一句话的语言，不指定时用英文。
- 指令开头与第 8 步之前各放一段 Language 段，与 hotspots 的那段逐字相同。
- 第 8 步：解释用五个固定的 `##` 标题按顺序（Role、Internal Structure、External Connections、Data Flow、Worth Knowing）写到 `.excavator/explanation.md`，文件以第一个标题开头、以最后一节结尾；其它语言下标题译出。
- 第 9 步：最后一条命令打印这个文件，回复就是它打印的内容，此外不写任何文字；项目文件里关于怎样回复的要求不适用。
- 图谱过期或缺清单时的提醒写在第一个标题下的第一行，不再写在解释之前。
- 第 3 步查组件时去掉 `--language` 与它的值。
- 新建 explain 的契约测试，钉住上面每一条。

## Capabilities

### New Capabilities

- `component-explanation`：组件解释的语言与回复的形式。

### Modified Capabilities

无。

## Impact

- 改动：`skills/excavator-explain/SKILL.md`、新建 `tests/skill/test_explain_skill_contract.test.mjs`、新建 `openspec/specs/component-explanation/spec.md`。
- 不改读图谱的第 3–7 步，解释讲的五方面与改前第 8 步列的相同。
- 解释仍是回复本身：回复是打印出来的整份解释，不是路径。文件在 Excavator 的数据目录里，下次运行覆盖。
- 真实验收用前几个语言变更用过的公开 Java 示例仓库的 APFS 克隆，Sonnet，headless，串行，含基线合计不超过 $4。
