## MODIFIED Requirements

### Requirement: 只支持 Claude Code 与 Codex 两个宿主

Skill script resolution SHALL try, in order, `${CLAUDE_PLUGIN_ROOT}`, `$HOME/.excavator-plugin`, and the root derived from the realpath of `~/.agents/skills/<skill>`; it SHALL NOT probe any other location. `install.sh` SHALL install for Codex only: one symlink per skill into `~/.agents/skills/` and one symlink `~/.excavator-plugin` to the repository root; it SHALL support `--uninstall`. Claude Code SHALL install via `.claude-plugin/marketplace.json` listing the single plugin `excavator`. `install.ps1` SHALL NOT exist. The runner image (capability `runner-image`) SHALL be a packaging of the Claude Code host, not a third host: it SHALL load the prebuilt checkout inside the image with `--plugin-dir`, SHALL expose that checkout at `$HOME/.excavator-plugin` so skill script resolution stays within the three locations above, and SHALL NOT copy skills or agents to any other location.

#### Scenario: Codex 安装与卸载
- **GIVEN** `HOME` points to an empty temporary directory
- **WHEN** `install.sh` runs
- **THEN** `~/.agents/skills/excavator*/SKILL.md` exists for all eight service skills and `~/.excavator-plugin` resolves to the repository root
- **WHEN** `install.sh --uninstall` runs
- **THEN** those symlinks are removed and no other file under `HOME` was touched

#### Scenario: 脚本定位只探测三处
- **WHEN** the resolution block in `skills/excavator/SKILL.md` is read
- **THEN** it lists exactly `${CLAUDE_PLUGIN_ROOT}`, `$HOME/.excavator-plugin`, and the `~/.agents/skills` realpath root, and the same block appears in `excavator-domain`

#### Scenario: 运行镜像不新增宿主
- **WHEN** the runner image is inspected
- **THEN** the plugin is loaded with `--plugin-dir` from the checkout at the path the image records, `$HOME/.excavator-plugin` resolves to that checkout, and no Excavator skill or agent file exists outside that checkout
