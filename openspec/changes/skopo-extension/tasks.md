## 1. 提案（提交 1）

- [x] 1.1 proposal、design（含验收 oracle O1–O7）、specs、tasks；`openspec validate --strict`

## 2. vendored 检查器（提交 2）

- [ ] 2.1 复制 `checker/`（D3），写 `SOURCE.json`，`keywords.json` 转义为 ASCII
- [ ] 2.2 `NOTICE` 加 Skopo 检查器一段
- [ ] 2.3 测试：O2（先用改坏的副本证明测试会失败）

## 3. `skopo.mjs` 的运行状态（提交 3）

- [ ] 3.1 `start`、`status`、`fresh`（D4）
- [ ] 3.2 `verdict` 的 `plan` 与 `create`（D10）
- [ ] 3.3 测试：O3、O5

## 4. 研究代理与两个 skill（提交 4）

- [ ] 4.1 `agents/skopo-researcher.md`（D9）
- [ ] 4.2 `skills/skopo-create/researcher-dispatch.md` 与 `jakarta-ee.md`（D6、D8）
- [ ] 4.3 `skills/skopo-plan/SKILL.md`、`skills/skopo-create/SKILL.md`（D6）
- [ ] 4.4 契约测试：阶段、续跑规则、不问用户、不写 lock、脚本路径；`check-refs`

## 5. 报告（提交 5）

- [ ] 5.1 `report-check`、`report-assemble`、`report-page`、`verdict --stage report`（D7）
- [ ] 5.2 `skills/skopo-report/SKILL.md` 与契约测试
- [ ] 5.3 测试：O4

## 6. runner（提交 6）

- [ ] 6.1 `deploy/skopo-mode.mjs`，`run-excavator.mjs` 的模式、参数与分派（D10）
- [ ] 6.2 `docs/deploy.md` 的参数表、模式与退出码
- [ ] 6.3 测试：O6

## 7. 验收（提交 7）

- [ ] 7.1 O1
- [ ] 7.2 O7 真实冒烟，记录进 design 的验收记录
