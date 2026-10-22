## Why

报告与写给用户的话默认用英文，只有调用时指定了语言才换。hotspots、unused-code、prd 与 verify 已按这条改过。`/excavator-onboard` 没有语言选项，也没有关于回复的规则：第 7 步生成指南，第 8–10 步是「整理成 markdown、提议保存、建议提交」。

改前的基线运行（main 上的 skill）：
- 夹具项目的 `AGENTS.md` 写着「Reply in Chinese. Lead with conclusions, changes, and verification results.」；
- 调用没有指定语言；
- $0.92，22 轮，约 5 分钟。

结果：
- **指南：** 英文，92 行，写在 headless 会话自己的 scratchpad 里，不在项目里，回复里也没有它的路径；
- **进度说明：** 4 段，都是英文；
- **最后的回复：** 中文，以「## 结论」开头，接着是「项目速览」「指南内容结构」「验证」三节，结尾问「是否要我将其保存为 `docs/EXCAVATOR_ONBOARDING.md`」。回复是项目文件要的形式，不是 skill 的；用户看不到指南在哪里。

## What Changes

- 加 `--language <lang>`：指南与运行中写给用户的每一句话的语言，不指定时用英文。
- 指令开头与最后回复之前各放一段 Language 段，与 hotspots 的那段逐字相同。
- 指南写到 `.excavator/onboarding-guide.md`，即 Excavator 的数据目录；用户说要时才复制进项目（默认 `docs/EXCAVATOR_ONBOARDING.md`）。
- 最后一步由一条命令打印回复的两行：指南的路径与保存的提议。回复就是这两行，项目文件里关于怎样回复的要求不适用。
- 图谱过期时，提醒同时写进指南的开头。回复只有两行，运行中的提醒用户可能看不到。
- 新建 onboard 的契约测试，钉住上面每一条。

## Capabilities

### New Capabilities

- `onboarding-guide`：入职指南的语言、写到哪里与最后的回复。

### Modified Capabilities

无。

## Impact

- 改动：`skills/excavator-onboard/SKILL.md`、新建 `tests/skill/test_onboard_skill_contract.test.mjs`、新建 `openspec/specs/onboarding-guide/spec.md`。
- 不改读图谱的步骤与指南的五节内容。
- 交互使用时，读指南要打开回复里的路径，比改前多一步；回复的形式不再随项目文件变。
- 真实验收用前几个语言变更用过的公开 Java 示例仓库的 APFS 克隆，Sonnet，headless，串行，含基线合计不超过 $6。
