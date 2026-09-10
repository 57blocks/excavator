# plugin-identity Specification

## Purpose
插件、skill、agent 与包的命名契约，以及 Claude Code 与 Codex 两宿主的安装方式和 hooks 的行为边界；后续所有步骤以这套名字为接口。

## Requirements

### Requirement: 插件与全部组件以 excavator 命名

The plugin manifest name SHALL be `excavator`. Every skill directory and its frontmatter `name:` SHALL be `excavator` or `excavator-<suffix>`. Every agent file and its frontmatter `name:` SHALL be `excavator-<role>`. Every workspace package SHALL be scoped `@excavator/*` or named `excavator-*`. The tokens `understand-anything`, `understandignore`, `UA_DIR` and the directory literal `.ua` SHALL NOT appear in tracked files other than `NOTICE`, files under `docs/`, planning artifacts under `openspec/` (which describe the rename itself), and the two upstream schema-URL lines in `scripts/lib/large-repo-benchmark.mjs` that must byte-match the `$id` in `docs/benchmarks/*.schema.json` (out of this change's scope). This gate SHALL run in `pnpm test` (`tests/refs/legacy-literals.test.mjs`), scanning `git ls-files` so untracked files cannot hide from it.

#### Scenario: 旧名 grep 为零
- **GIVEN** the repository at HEAD
- **WHEN** `grep -rniE 'understand-anything|understandignore|UA_DIR|\.ua\b' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=docs --exclude-dir=openspec .` runs
- **THEN** it matches only `NOTICE` and the two schema-URL lines in `scripts/lib/large-repo-benchmark.mjs`

#### Scenario: 名字与位置一致
- **WHEN** `scripts/check-refs.mjs` runs
- **THEN** every `skills/<dir>/SKILL.md` has `name: <dir>` and every `agents/<file>.md` has `name: <file>`

### Requirement: 只支持 Claude Code 与 Codex 两个宿主

Skill script resolution SHALL try, in order, `${CLAUDE_PLUGIN_ROOT}`, `$HOME/.excavator-plugin`, and the root derived from the realpath of `~/.agents/skills/<skill>`; it SHALL NOT probe any other location. `install.sh` SHALL install for Codex only: one symlink per skill into `~/.agents/skills/` and one symlink `~/.excavator-plugin` to the repository root; it SHALL support `--uninstall`. Claude Code SHALL install via `.claude-plugin/marketplace.json` listing the single plugin `excavator`. `install.ps1` SHALL NOT exist.

#### Scenario: Codex 安装与卸载
- **GIVEN** `HOME` points to an empty temporary directory
- **WHEN** `install.sh` runs
- **THEN** `~/.agents/skills/excavator*/SKILL.md` exists for all nine skills and `~/.excavator-plugin` resolves to the repository root
- **WHEN** `install.sh --uninstall` runs
- **THEN** those symlinks are removed and no other file under `HOME` was touched

#### Scenario: 脚本定位只探测三处
- **WHEN** the resolution block in `skills/excavator/SKILL.md` is read
- **THEN** it lists exactly `${CLAUDE_PLUGIN_ROOT}`, `$HOME/.excavator-plugin`, and the `~/.agents/skills` realpath root, and the same block appears in `excavator-dashboard` and `excavator-domain`

### Requirement: hooks 只建议不执行

The SessionStart hook SHALL describe detected structural changes and propose running `/excavator`; it SHALL NOT instruct the agent to run analysis without the user's decision.

#### Scenario: 提示词无自动执行指令
- **WHEN** `hooks/hooks.json` and `hooks/auto-update-prompt.md` are read
- **THEN** neither contains "Do not ask the user for confirmation" nor an equivalent auto-execute directive, and the prompt ends with a suggestion that awaits the user
