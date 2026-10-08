本变更零产品代码：新增 `skills/excavator-verify/SKILL.md`，修改 `skills/excavator-prd/SKILL.md`。门禁以 `check-refs`、`pnpm test`、`openspec validate --strict` 为准；验收以 design.md「验收」节的固定标准在 Fineract 上实测。

## 1. 计划

- [ ] 1.1 提交 proposal / design / specs / tasks，`openspec validate prd-verification --strict` 通过。

## 2. 核对 skill

- [ ] 2.1 新增 `skills/excavator-verify/SKILL.md`：五类候选、全仓取证规则、按章节并行、跨章节一致性、无第四态判定桶、报告格式、`--fix` 改正规则与核对摘要。
- [ ] 2.2 `name: excavator-verify` 与目录名一致，引用可解析（`check-refs`）。

## 3. PRD 集成

- [ ] 3.1 `skills/excavator-prd/SKILL.md`：写作阶段的高风险陈述取证规则；Phase 4 保存前按 `excavator-verify` 流程 `--fix` 并报告计数。

## 4. 文档与测试

- [ ] 4.1 README 增加 `/excavator-verify` 用法。
- [ ] 4.2 `tests/install/install.test.mjs`：skill 数 9 → 10，断言包含 `excavator-verify`。

## 5. 门禁

- [ ] 5.1 `node scripts/check-refs.mjs` 通过。
- [ ] 5.2 `pnpm -r build && pnpm test` 全绿。

## 6. 验收（Fineract 实测，输出不提交）

- [ ] 6.1 装置自检：植入 P1–P4 的 PRD 副本上单独运行 `excavator-verify`，4/4 判为 contradicted 或 misattributed；报告 P5 是否被发现。
- [ ] 6.2 真实错误召回 ≥ 6/7；A/B 以外的 contradicted/misattributed 逐条复核，精确度目标 ≥ 80%；报告未决项消解数与章节冲突发现数。
- [ ] 6.3 时间与费用：与生成时间（21 分钟）、费用（约 62 美元）对比，目标各 ≤ 50%；如实记录。
- [ ] 6.4 集成：修改后的 `excavator-prd` 在 `fineract-progressive-loan` 范围重跑，对比改前约 12 分钟 / 13.68 美元，报告增量与 `--fix` 改正条数。
- [ ] 6.5 把 6.1–6.4 的数字写回本文件，分阶段提交（计划、核对 skill、PRD 集成、文档测试、验收记录），PR 以 merge commit 合入 main。
