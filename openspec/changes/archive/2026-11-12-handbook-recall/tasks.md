## 1. 第一轮不删、第二轮可收窄

- [x] 1.1 测试先红：第一轮 `contradicted` 进改写文件、不删任何项；第二轮接受列出项改主张、拒绝每一种名称或标签的改变、拒绝没列出项的改变；`narrowed` 记录留下与删去的项；概览、功能的发现、系统的发现各一例
- [x] 1.2 `verdicts.mjs` 第一轮只列不删；`verify-plan.mjs` 按名称键比较；第二轮定案写 `narrowed`

## 2. 提示词

- [x] 2.1 合约测试先红：改写提示词、核对者定义、`features.md` 的新段落与原有规则
- [x] 2.2 `SKILL.md` 第 5 阶段第 3、4、5、7 步与改写提示词；`agents/excavator-handbook-verifier.md` 两条新规则；`sections/features.md`「先查例外，再写通则」

## 3. 验收

- [x] 3.1 O2 变异
- [x] 3.2 O5 测试与检查
- [ ] 3.3 O4 真实运行（先报花费）与独立审读，写 `acceptance.md`

> 归档说明（2026-11-12）：未勾选的项目是真实运行验收，被 handbook-skill-first 取代，不再执行。

> 归档说明（2026-11-12）：本变更的规格增量与前面几个变更的增量冲突，未同步进主规格，以 `--skip-specs` 归档；其中仍然成立的要求由 handbook-skill-first 的规格重新写入。
