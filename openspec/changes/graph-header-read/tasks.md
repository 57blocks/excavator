## Commit 序列

0. `docs(openspec): propose graph-header-read`：本变更的四个文件。
1. `fix(benchmark): read only the graph header for the sample node count`：`graphNodeCount` 与 `readSample`，加测试（1.1–1.3）。
2. `docs(openspec): record graph-header-read acceptance and archive`：验收记录、同步主规范、归档（2.1–2.3）。

## 1. 实现

- [ ] 1.1 `scripts/lib/full-run-report.mjs`：
  - `graphNodeCount` 用 `openSync`/`readSync` 按 64 KiB 一块读到第一个换行，拼好字节再解码、解析；文件描述符在 `finally` 里关闭；
  - 任何一步失败返回 `null`；
  - `readSample` 加可选参数 `{ read }`，默认 `readSync`，传给 `graphNodeCount`。
- [ ] 1.2 `tests/benchmark/test_full_run_report.test.mjs`：
  - 头记录后跟 1 MB 内容，注入的读取函数每次最多 64 字节，断言节点数与读到的字节数；
  - 没有结尾换行的头记录照常解析，第一行不是 JSON 时记为缺失。
- [ ] 1.3 变异 M1–M3 各自变红；全量门：vitest、`check-refs`、`openspec validate --all --strict`。

## 2. 验收

- [ ] 2.1 O2：先在 `origin/main` 的代码上确认回放以 1 退出、报 `ERR_STRING_TOO_LONG`，再在本分支上回放，按 design.md 的通过条件逐条检查。
- [ ] 2.2 在 design.md 末尾写验收记录：O1、O2 的结果。
- [ ] 2.3 同步主规范 `full-run-measurement`，归档本变更。
