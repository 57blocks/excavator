## Why

导入的 Understand-Anything 插件仍以上游名字运行：plugin 名、9 个 skill、10 个 agent、5 个包名、`.ua/` 数据目录、`.understandignore`、`$HOME/.understand-anything-plugin` 安装根、dashboard 六语言文案与标题、viewer 的 bin 与环境变量。用户要求（2026-09-10）：内部所有名称改为 excavator 且引用关系自洽；零兼容，不留旧目录/旧名回退；只保留 Claude Code 与 Codex 两个宿主；hooks 不得自动执行。改名是后三步的前提——陈述可核验（②）、cebreo（③）、MCP（④）都以 `.excavator/` 与新名字为契约。

## What Changes

- **名称**：plugin `excavator`；skills `excavator`、`excavator-chat`、`-diff`、`-explain`、`-onboard`、`-domain`、`-knowledge`、`-dashboard`、`-figma`；agents `excavator-<原名>`（10 个）；包 `@excavator/{core,dashboard,skill,tree-sitter-dart-wasm,tree-sitter-swift-wasm}`、`excavator-viewer`；数据目录 `.excavator/`；忽略文件 `.excavatorignore`；安装根 `$HOME/.excavator-plugin`；env `EXCAVATOR_ACCESS_TOKEN`；品牌文案 Excavator，上游致谢只在 `NOTICE`。
- **BREAKING** 删除全部回退分支：`.understand-anything` 探测在 core persistence、hooks、figma、knowledge、dashboard、viewer、prepare-incremental、SKILL.md 共 11 处，另有 agents/SKILL.md 里逐字复制的 `existsSync(...) ? ... : '.ua'` 三元式；目录名改为单一常量来源。旧 `.ua/` 产物不再被识别。
- **默认忽略**加 `.claude/ .agents/ .codex/ .excavator/`；`ignore-filter.ts` 的 `DEFAULT_IGNORE_PATTERNS` 与 `scan-project.mjs` 的自排除同步并加测试。
- **hooks**：SessionStart 提示只建议、不执行；删除「Do not ask the user for confirmation — just do it」。
- **BREAKING** 两宿主：SKILL.md 的 PLUGIN_ROOT 候选从 8 个缩到 3 个；新 `install.sh`（Codex：逐 skill 符号链接到 `~/.agents/skills/` + `$HOME/.excavator-plugin`）；删 `install.ps1`；`tests/install/*` 改为测新安装器（同时消掉上游继承的 kimi 目录名不一致红）；新 `.claude-plugin/marketplace.json`（plugin source 为仓库根）；`README.md` 换成 Excavator 自己的。
- **引用完整性门** `scripts/check-refs.mjs` 进 `pnpm test`，含先验装置测试（坏一条引用必红）。
- 根 `package.json` 恢复 `private: true`；`.claude/settings.json` 的 push 守卫扩到 `excavator-v2`（所有改动经 PR）。
- **wcp 既有 UA 产物改名复用**（`.ua/` → `.excavator/`，先存基线）；wcp 与 cebreo 各跑一次确定性阶段冒烟（产物不提交）。

## Capabilities

### New Capabilities
- `plugin-identity`: 插件、skill、agent、包的命名；manifest 与两宿主安装；hooks 只建议不执行
- `data-directory`: `.excavator/` 单一数据目录、`.excavatorignore`、无回退、默认排除 agent 与数据目录
- `reference-integrity`: 交叉引用机械核对门与其先验装置

### Modified Capabilities
（无：本仓尚无 accepted spec）

## Impact

- 约 107 个文件内容改动 + 19 个目录/文件改名；`pnpm-lock.yaml` 因包名变更重生。
- 上游安装表测试被**替换**（安装器被替换，不是弱化），其余测试只改路径与名称，用例数不减少（替换的测试数在 PR 里逐条列出）。
- 被分析仓库的产物目录从 `.ua/` 变为 `.excavator/`；旧产物不再被识别（零兼容），wcp 手工改名复用一次。
- Non-goals：不改抽取/图/schema 的任何行为（②）；不加语言（③）；不建 MCP（④）；Figma skill 只改名不改功能。
