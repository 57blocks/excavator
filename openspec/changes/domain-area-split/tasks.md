提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

## 1. 抽取上限可见

- [ ] 1.1 红测试（`tests/domain/extract-domain-context.test.mjs`）：O1 的两条；`truncated` 字段存在。
- [ ] 1.2 改 `extract-domain-context.py`：去掉每目录上限；入口点上限 5,000 并计数；所有文件给签名；整体超预算时不删条数。
  - **验证：** 1.1 绿。

## 2. 分区

- [ ] 2.1 红测试（`tests/domain/split-domain-areas.test.mjs`）：O2 全部；图节点越界不附；测试文件不进模块并计数。
- [ ] 2.2 实现 `skills/excavator-domain/split-domain-areas.mjs`（导出纯函数 `planAreas` 供测试，CLI 写文件）。
  - **验证：** 2.1 绿。

## 3. 合并与覆盖

- [ ] 3.1 多模块夹具生成器 `tests/fixtures/domain-areas/multi-module.mjs`：24 个 handler 模块、定时任务、事件消费者、前端页面、CLI，分在 4 个子项目里；通用业务名。
- [ ] 3.2 红测试（`tests/domain/merge-domain-areas.test.mjs`）：O3、O4 全部；装置先验：给一份全覆盖的录制输出，报告 `silent-zero` 为 0；去掉 8 个模块的流程后恰好报出这 8 个。
- [ ] 3.3 实现 `skills/excavator-domain/merge-domain-areas.mjs`（导出 `mergeAreas`、`computeCoverage`）。
  - **验证：** 3.2 绿。

## 4. skill 与分析器

- [ ] 4.1 红测试（`tests/domain/domain-skill-contract.test.mjs`）：SKILL.md 调用分区与合并脚本、传 `--reports-dir`、不含 `./extract-domain-context.py` 与 `<SKILL_DIR>`；分析器提示词有 Option C、`areaRun`、`skippedModules`，不含全局数量上限。
- [ ] 4.2 改 `SKILL.md` 与 `agents/excavator-domain-analyzer.md`。
  - **验证：** 4.1 绿；`node scripts/check-refs.mjs`；读这两个文件的既有测试绿。

## 5. 实测与收尾

- [ ] 5.1 O5：合成夹具上分别跑单分析器与按区，记录前后覆盖。
- [ ] 5.2 `openspec validate --all --strict`；受影响测试；PR 写明跑了什么、实测数字。
