## 1. 提案（提交 1）

- [x] 1.1 proposal、design（含验收 oracle O1–O7）、specs、tasks；`openspec validate --strict`

## 2. 三个 skill（提交 2）

检查器、脚本与 skill 一起提交：`skills/skopo-create/` 没有 `SKILL.md` 时 `check-refs` 不过，报告的检查又是 `verdict` 的一部分，拆开的中间版本过不了门。

- [x] 2.1 复制 `checker/`（D3），写 `SOURCE.json`，`keywords.json` 转义为 ASCII；`NOTICE` 加 Skopo 检查器一段
- [x] 2.2 `skopo.mjs`：`start`、`status`、`fresh`（D4），`verdict`（D10），`report-check`、`report-assemble`、`report-page`（D7）
- [x] 2.3 `agents/skopo-researcher.md`（D9）与 `skills/skopo-create/jakarta-ee.md`（D8）
- [x] 2.4 `skills/skopo-plan/SKILL.md`、`skills/skopo-create/SKILL.md`、`skills/skopo-report/SKILL.md`（D6、D7）
- [x] 2.5 测试：O2、O3、O4、O5，skill 契约测试；随新 agent 与新 skill 更新加载夹具与安装测试的计数

## 3. runner（提交 3）

- [x] 3.1 `deploy/skopo-mode.mjs`，`run-excavator.mjs` 的模式、`EXCAVATOR_SCOPE`、`buildPromptArgs` 与 `runSkopo`（D10）
- [x] 3.2 `docs/deploy.md` 的运行示例、参数表与退出码
- [x] 3.3 测试：O6（假的 `claude` 写出合规与不合规的产物，由真实的 `verdict` 判定）

## 4. 验收（提交 4）

- [x] 4.1 O1
- [x] 4.2 O7 真实冒烟，记录进 design 的验收记录
- [x] 4.3 `jakarta-ee.md` 的开头改为先用事实层追接线（O7 发现研究代理跳过了事实层）
