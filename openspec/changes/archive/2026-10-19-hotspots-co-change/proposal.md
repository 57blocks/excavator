## Why

热点只回答「哪里改得多」，回答不了「改 A 的时候通常还要改什么」。动一块代码之前最常问的是后者，而这种联系静态分析往往看不到，比如 Java 页面类和 xhtml、代码和配置键、代码和 properties。

在 dataverse 上用只读 git 粗测（没跟踪改名）：
- `EjbDataverseEngine.java` 和 `CommandContext.java` 一起改了 48 次，占改得较少那个文件的 76%；
- `JvmSettings.java` 和 `microprofile-config.properties` 一起改了 20 次；
- `DatasetVersionUI.java` 和 `dataset.xhtml` 一起改了 31 次。

这类计数要扫完整历史、按提交去重，还要沿改名归到当前路径，只能由脚本来做。读数、叙述交给模型。

## What Changes

- 热点产物新增两部分：
  - **头部 `coChange`**：
    - 规则：一次提交最多计入 30 个选中文件，一起改至少 3 次才列出；
    - 计数：计入的提交数、超过上限没计入的提交数、列出的文件对数、不足 3 次没列出的文件对数。
  - **`pairs`**：每对文件一起改的提交数，以及它占两个文件各自提交数的比例。沿用现有的改名归属和窗口。
- 改动超过 30 个选中文件的提交不计入文件对。批量格式化、改版本号、改 license 头会造出大量假配对。这类提交的条数写在头部，也列入残余假设。
- `/excavator-hotspots` 的汇报加上一起改得最多的文件对，并单列两边路径都不像测试的文件对。只说「一起改了 N 次」，不说依赖、调用或因果。
- `excavator-chat` 能回答「改 X 的时候通常还要改什么」，只从产物回答。
- 不做：
  - 目录级的共变；
  - 按提交说明给提交分类；
  - 按作者统计。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `change-hotspots`：
  - 新增「一起改的文件」；
  - 「产物、新鲜度与查询」的头部、残余假设，以及 skill 与 chat 的读法，加上文件对。

## Impact

- 脚本：`skills/excavator/hotspots.mjs`，新增 `skills/excavator/hotspots/co-change.mjs`。
- skill：`skills/excavator-hotspots/SKILL.md`、`skills/excavator-chat/SKILL.md`。
- 测试：`tests/skill/excavator/test_hotspots.test.mjs`、`tests/skill/test_hotspots_skill_contract.test.mjs`。
- 产物格式仍是 `excavator-hotspots/1`，只加字段。读头部的查询要把 `pairs` 一起排除。
