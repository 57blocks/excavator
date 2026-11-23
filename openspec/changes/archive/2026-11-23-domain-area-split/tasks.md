提交序列见 proposal。每个脚本任务先写红测试，看它失败，再实现。

## 1. 抽取上限可见

- [x] 1.1 红测试（`tests/domain/extract-domain-context.test.mjs`）：O1 的两条；`truncated` 字段存在。
- [x] 1.2 改 `extract-domain-context.py`：去掉每目录上限；入口点上限 5,000 并计数；所有文件给签名；整体超预算时不删条数。
  - **验证：** 1.1 绿。

## 2. 分区

- [x] 2.1 红测试（`tests/domain/split-domain-areas.test.mjs`）：O2 全部；图节点越界不附；测试文件不进模块并计数。
- [x] 2.2 实现 `skills/excavator-domain/split-domain-areas.mjs`（导出纯函数 `planAreas` 供测试，CLI 写文件）。
  - **验证：** 2.1 绿。

## 3. 合并与覆盖

- [x] 3.1 多模块夹具生成器 `tests/fixtures/domain-areas/multi-module.mjs`：24 个 handler 模块、定时任务、事件消费者、前端页面、CLI，分在 4 个子项目里；通用业务名。
- [x] 3.2 红测试（`tests/domain/merge-domain-areas.test.mjs`）：O3、O4 全部；装置先验：给一份全覆盖的录制输出，报告 `silent-zero` 为 0；去掉 8 个模块的流程后恰好报出这 8 个。
- [x] 3.3 实现 `skills/excavator-domain/merge-domain-areas.mjs`（导出 `mergeAreas`、`computeCoverage`）。
  - **验证：** 3.2 绿。

## 4. skill 与分析器

- [x] 4.1 红测试（`tests/domain/domain-skill-contract.test.mjs`）：SKILL.md 调用分区与合并脚本、传 `--reports-dir`、不含 `./extract-domain-context.py` 与 `<SKILL_DIR>`；分析器提示词有 Option C、`areaRun`、`skippedModules`，不含全局数量上限。
- [x] 4.2 改 `SKILL.md` 与 `agents/excavator-domain-analyzer.md`。
  - **验证：** 4.1 绿；`node scripts/check-refs.mjs`；读这两个文件的既有测试绿。

## 5. 实测与收尾

- [x] 5.1 O5：合成夹具上分别跑单分析器与按区，记录前后覆盖。
  - 小夹具（37 个模块、134 个入口点）的单分析器没有漏后端 handler，只漏了前端页面，不足以证明问题，所以加了大夹具 `tests/fixtures/domain-areas/large-multi-module.mjs`（88 个模块、1,352 个源文件、173 个入口点，其中 46 个模块有入口点）。
  - 大夹具实测（Sonnet，各跑一次，n=1）：单分析器（main 上的抽取与提示词）在 46 个有入口点的模块里覆盖 14 个、静默为零 32 个（30 个 handler 模块里漏 19 个，13 个前端模块里漏 12 个）；按区（9 个区）覆盖 46 个、静默为零 0 个，其余 42 个无入口点模块全部带理由声明跳过。
  - 两次运行都是 n=1，只量覆盖，不量步骤内容质量；有两个区的分析器用脚本生成了模板化的步骤摘要。
- [x] 5.2 `openspec validate --all --strict`；受影响测试；PR 写明跑了什么、实测数字。
