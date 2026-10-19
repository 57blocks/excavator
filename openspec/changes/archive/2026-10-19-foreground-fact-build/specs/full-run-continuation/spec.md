## ADDED Requirements

### Requirement: 事实构建在前台运行

`/excavator` skill 跑自己的脚本时 SHALL 在前台运行，等脚本结束再继续。
- `lazy-analyze.mjs` 在大仓库上要几分钟，skill SHALL 把它的 shell 工具超时设为上限：Claude Code 的 Bash 工具是 600000 毫秒。
- skill MUST NOT 把这些脚本放到后台。headless 运行（`claude -p`，部署镜像的 full 模式）在编排者这一轮结束时退出，后台进程随之被杀，运行留下没有事实图的 `.excavator/`。
- 这条规则 SHALL 写在 skill 的总规则里，也写在跑 `lazy-analyze.mjs` 的两处：Lazy 模式与 Phase F1。

#### Scenario: 大仓库上的 headless 预估
- **WHEN** 在一个 Lazy 要约 3 分钟的仓库上，headless 运行 `/excavator --full --estimate`
- **THEN** 记录里 `lazy-analyze.mjs` 的调用在前台、超时为 600000 毫秒，没有放到后台的命令，运行走到预估报告

#### Scenario: 规则在动手的地方
- **WHEN** 读 SKILL.md 里 Lazy 模式与 Phase F1 运行 `lazy-analyze.mjs` 的段落
- **THEN** 每处都写明在前台运行、超时 600000 毫秒、不放到后台
