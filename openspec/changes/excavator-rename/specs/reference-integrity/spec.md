## Purpose

机械核对插件内部所有交叉引用（skill 名、agent 名、脚本路径、hooks 路径、i18n key）的门，并用先验装置证明门本身看得见坏引用。

## ADDED Requirements

### Requirement: 交叉引用机械核对

`scripts/check-refs.mjs` SHALL verify, without network or dependencies: (1) each `skills/*/SKILL.md` frontmatter `name` equals its directory name and each `agents/*.md` frontmatter `name` equals its file name; (2) every agent referenced in `skills/**/*.md`, `agents/*.md` or `hooks/*` — as a backticked `excavator-<role>` or as an `agents/<file>.md` path — exists; (3) every `/excavator` or `/excavator-<suffix>` slash reference names an existing skill directory; (4) every referenced `.mjs`, `.py` or `.sh` path, after stripping `${CLAUDE_PLUGIN_ROOT}` or `$PLUGIN_ROOT`, exists relative to the repository root or the referencing skill directory; (5) every `${CLAUDE_PLUGIN_ROOT}/...` path in `hooks/hooks.json` exists; (6) all files in `packages/dashboard/src/locales/` export the same key set. It SHALL exit non-zero and print one line per broken reference. It SHALL run as part of `pnpm test`.

#### Scenario: 全部引用可解析
- **GIVEN** the repository at HEAD
- **WHEN** `node scripts/check-refs.mjs` runs
- **THEN** it exits 0 and prints the counts of skills, agents, scripts and locale keys it checked

#### Scenario: 先验装置——坏一条引用必红
- **GIVEN** a copy of the repository in a temporary directory where one `agents/excavator-<role>.md` is renamed
- **WHEN** `node scripts/check-refs.mjs` runs against that copy
- **THEN** it exits non-zero and its output names the missing agent and at least one file that referenced it

#### Scenario: 门在测试套件中
- **WHEN** `pnpm test` runs
- **THEN** a test invokes check-refs against the repository and a second test executes the broken-reference scenario above
