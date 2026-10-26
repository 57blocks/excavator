## 1. 新 skill（提交 2）

- [x] 1.1 把 `33c1566d` 上的 `skills/excavator-prd/` 复制到 `skills/excavator-prd-report/`，按 design D3 改名
- [x] 1.2 把 `tests/skill/excavator-prd/` 复制到 `tests/skill/excavator-prd-report/`，`tests/skill/test_prd_skill_contract.test.mjs` 复制为 `tests/skill/test_prd_report_skill_contract.test.mjs`，路径与名字按 D3 改
- [x] 1.3 `tests/fixtures/prd-pipeline/` 复制为 `tests/fixtures/prd-report-pipeline/`，其中的 `format` 标识按 D3 改，新测试指向它
- [x] 1.4 `tests/install/install.test.mjs` 的 skill 数改为 16，并期待 `excavator-prd-report`
- [x] 1.5 跑 O3、O4

## 2. 恢复单篇版（提交 3）

- [x] 2.1 `git checkout 33c1566d^1 -- skills/excavator-prd tests/skill/test_prd_skill_contract.test.mjs`，删掉 `skills/excavator-prd/` 下 `33c1566d^1` 没有的文件、`tests/skill/excavator-prd/` 与 `tests/fixtures/prd-pipeline/`
- [x] 2.2 跑 O1（skill 与测试部分）、O3

## 3. 文档（提交 4）

- [x] 3.1 `README.md`：`/excavator-prd` 的注释恢复为 `33c1566d^1` 的单篇说明，紧接着加一条 `/excavator-prd-report`，用 PR #81 写的那段流水线说明（默认目录改为 `.excavator/prd-report/`）
- [x] 3.2 `docs/deploy.md`：容器示例命令与其后的产物说明段改到 `/excavator-prd-report` 名下（`--out`、`--concurrency` 是它的选项）；耗时表里 `/excavator-prd` 那一行恢复为 `33c1566d^1` 的文字（那次测的就是单篇版）
- [x] 3.3 跑 O3、O5

## 4. 验收与归档

- [x] 4.1 跑 O2（含装置先验），结果写进 design.md 的验收记录（提交 5）
- [ ] 4.2 归档变更，跑 O1 的 spec 部分
