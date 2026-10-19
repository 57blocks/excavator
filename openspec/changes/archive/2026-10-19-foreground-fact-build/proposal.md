## Why

在 hadoop（16,220 个文件）上用 headless Sonnet 跑 `/excavator --full --estimate`，运行在 2.5 分钟、$0.81 时就结束了，没有给出预估。

- 编排者把 F1 的 Lazy 放到了后台，然后结束了这一轮。这个仓库上 Lazy 约要 3 分钟。
- headless 运行（`claude -p`）在这一轮结束时退出，后台命令随之被杀。`.excavator/` 里没有事实图。
- 用 Haiku 做了三次探针，`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` 分别设为 0、不设、120 秒，结果相同：退出时不等后台命令，后台命令也没有跑完。

部署镜像的 full 模式也是一次 `claude -p`，F1 由编排者自己跑。所以只要一个仓库的 Lazy 超过约两分钟，无人值守的 Full 都会这样提前结束，而这正是大仓库的场景。jpetstore 与 conduit 上没有出现，因为它们的 Lazy 很快。

只说「不要放到后台」不够。Bash 工具的默认超时是 2 分钟，超时的前台命令也会被移到后台，所以还要把超时给足。

## What Changes

- `skills/excavator/SKILL.md` 加一条总规则：skill 的脚本一律在前台运行并等它结束，不放到后台；`lazy-analyze.mjs` 的超时设为 Bash 工具的上限 600000 毫秒。规则写明原因：headless 运行在这一轮结束时退出。
- 跑 `lazy-analyze.mjs` 的两处（Phase 0 step 6.5 的 Lazy、Phase F1）在命令旁边再写一次，因为模型是在那里动手的。
- 契约测试钉住总规则与两处调用。
- 不改脚本、运行器与部署镜像。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `full-run-continuation`：新增要求「事实构建在前台运行」。

## Impact

- `skills/excavator/SKILL.md`。
- `tests/skill/excavator/test_full_run_continuation_contract.test.mjs`。
- core、运行器 `scripts/benchmark-full-run.mjs`、部署镜像 `deploy/` 都不变。
