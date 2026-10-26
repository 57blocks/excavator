## Why

`prd-feature-pipeline`（PR #81）把 `/excavator-prd` 整个换成了「总览 → 按功能并发 → 汇总」的流水线，产物从一篇 PRD 变成一个目录。单篇 PRD 仍有用：小范围、一次写完、一个文件交付，不需要入口目录、泳道、续跑与锁。两种用法应各有一个入口，而不是让单篇写作消失。

流水线的去向也已定：它要再加一个独立的 HTML 报告页，把总览、各功能的 PRD 与 findings 关联起来。这属于「全部 PRD + 问题 + 报告页」的用途，应归一个新的 skill，而不是继续叠在 `/excavator-prd` 上。

## What Changes

- **`/excavator-prd` 恢复为单篇 PRD**：`skills/excavator-prd/SKILL.md` 与 `tests/skill/test_prd_skill_contract.test.mjs` 逐字节恢复为 PR #81 合并前（`33c1566d^1`）的内容；`prd-generation` spec 恢复为当时的要求。
- **新增 `/excavator-prd-report`**：PR #81 的流水线整体移入 `skills/excavator-prd-report/`（`SKILL.md`、`prd.mjs`、`lib/`、`entrypoint-catalog.json`），测试移入 `tests/skill/excavator-prd-report/` 与 `tests/skill/test_prd_report_skill_contract.test.mjs`。行为不变，只改名字：
  - skill 名、命令与路径里的 `excavator-prd` 改为 `excavator-prd-report`；
  - `--out` 的默认值改为 `<project>/.excavator/prd-report/`；
  - 产物的 `format` 标识改为 `excavator-prd-report/1`、`excavator-prd-report-entrypoints/1`、`excavator-prd-report-findings/1`。
- 新能力 `prd-report` 承接 `prd-generation` 里属于流水线的要求。
- `README.md`、`docs/deploy.md`、安装测试同时列出两个 skill。
- **不做（下一个变更 `prd-report-page`）**：独立的 `report.html`（总览页、按功能看 PRD 与 findings、mermaid 渲染）。本变更只拆分，不加功能。

## Capabilities

### New Capabilities

- `prd-report`：按功能并发产出全部 PRD 章节与功能级 findings、断点续跑、产物目录与 `PRD.md` 拼装，只写 `--out`。

### Modified Capabilities

- `prd-generation`：恢复为单篇 PRD 的写作要求；按功能并发、findings、输出目录与拼装四条要求移到 `prd-report`。

## Impact

- `skills/excavator-prd/`（恢复）、`skills/excavator-prd-report/`（新增，由移动而来）。
- `tests/skill/`、`tests/fixtures/prd-pipeline/`、`tests/install/install.test.mjs`。
- `README.md`、`docs/deploy.md`。
- PR #81 版本写下的目录（默认 `.excavator/prd/`，`format` 为 `excavator-prd/1`）不被新 skill 续跑：默认位置不同，不会撞上；显式把 `--out` 指向旧目录时，`--fresh` 按现有规则拒绝删除不认识的目录。按 AGENTS.md 的零兼容，不加兼容分支。
