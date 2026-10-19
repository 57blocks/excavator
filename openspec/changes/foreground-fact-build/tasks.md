## Commit 序列

0. `docs(openspec): propose foreground-fact-build`：本变更的四个文件。
1. `fix(skill): run the fact build in the foreground with the full timeout`：SKILL.md 的总规则与两处调用点，加契约测试（1.1、1.2）。
2. `docs(openspec): record foreground-fact-build acceptance and archive`：验收记录、同步主规范、归档（2.1–2.3）。

## 1. 实现

- [ ] 1.1 `skills/excavator/SKILL.md`：
  - 在 Phase 0 之前加「Running the scripts」：前台运行并等它结束，不用 `run_in_background`，`lazy-analyze.mjs` 的超时给 600000 毫秒，并说明 headless 运行在这一轮结束时退出；
  - Phase 0 step 6.5 的 Lazy 与 Phase F1 的 `lazy-analyze.mjs` 命令旁各写一句，指向总规则。
- [ ] 1.2 `tests/skill/excavator/test_full_run_continuation_contract.test.mjs`：钉住三处，并用注入变异确认能变红。
- [ ] 1.3 全量门：vitest、`check-refs`、`openspec validate --all --strict`。

## 2. 验收

- [ ] 2.1 O2：在 hadoop 上 headless 跑 `--full --estimate`，按 design.md 的通过条件逐条检查。
- [ ] 2.2 在 design.md 末尾写验收记录：O1、O2 的结果，以及 hadoop 的预估数字。
- [ ] 2.3 同步主规范 `full-run-continuation`，归档本变更。
