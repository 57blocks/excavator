## 1. 单元、种子与检查（脚本）

提交：`feat(product-handbook): each application root has a system findings unit with the checks of a finding`

- [x] 1.1 夹具与测试先红：种子、单元 id、状态键与 `root`、两道检查、`--applications`（design O1）
- [x] 1.2 `system-seeds`；`unit.mjs` 第四种单元；`state.json` 的 `systemFindings` 键；`check-system-findings`、`try-system-findings`；`mark`、`slices`、`verdicts`、`trace`、`trace-verdicts` 接受系统发现单元（design D2、D3、D4）

## 2. 阶段文字

提交：`feat(product-handbook): the system-findings section writes, verifies and traces the findings of each application root`

- [x] 2.1 `lib/sections.mjs` 加 `system-findings`；`sections/system-findings.md` 第 4d 阶段与子代理提示（design D1、D5）
- [x] 2.2 `SKILL.md`：选项 `--applications`，第 5、6 阶段列出系统发现单元，「部分」规则；合约测试更新摘要（design D6）

## 3. 合并与呈现

提交：`feat(product-handbook): findings at the same place are one, and the system findings are shown with their application`

- [x] 3.1 分组（design D7），测试先红
- [x] 3.2 「发现」一章、覆盖、拼装前的复查；页面数据 `/10`、归属与组（design D8）
- [x] 3.3 渲染与页面测试（design O2）

## 4. 否定与对比的范围词

提交：`feat(product-handbook): negative and contrasting outcomes are scope words a tracer builds a case for`

- [ ] 4.1 测试先红：表里有新词、追查文件带出这些词、追查者说明（design D10）
- [ ] 4.2 `ui-strings.json`、追查者 agent 的说明；合约测试更新摘要

## 5. 验收

提交：`docs(openspec): record handbook-system-findings acceptance`

- [ ] 5.1 变异检查，结果写进 `acceptance.md`
- [ ] 5.2 O3 真实运行与独立抽查，没过的线照实写
- [ ] 5.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
