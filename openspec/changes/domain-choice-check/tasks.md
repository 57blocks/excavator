提交序列见 proposal。先写红测试，看它失败，再实现。

## 1. 接受检查

- [x] 1.1 红测试（`tests/domain/choice-check.test.mjs`、`tests/domain/merge-domain-areas.test.mjs`）：O1–O4。
- [x] 1.2 改 `merge-domain-areas.mjs`：抽出 `homeModuleOf`；`checkChoices`；`acceptOutput` 的 `choice` / `allowUnchosen`；`rejected-choice` 行；`--check`、`--accept-unchosen`。改 `split-domain-areas.mjs`：区上下文写 `check`。既有多模块端到端夹具的支撑模块流程补上选择。
  - **验证：** 1.1 绿；新测试在旧脚本上红。

## 2. skill 与分析器

- [x] 2.1 红测试（`tests/domain/domain-skill-contract.test.mjs`）：O5。
- [x] 2.2 改 `agents/excavator-domain-analyzer.md`、`skills/excavator-domain/SKILL.md`。
  - **验证：** 2.1 绿；`node scripts/check-refs.mjs`；读这些文件的既有测试绿。

## 3. 收尾

- [x] 3.1 `openspec validate --all --strict`；`tests/domain/` 与读 skill/agent 文件的测试；PR 写明跑了什么。
