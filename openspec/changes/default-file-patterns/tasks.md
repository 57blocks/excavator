执行约束：
- 人员：一个 coder，一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目，不安装运行时，不下载依赖。
- 分支：`fix/default-file-patterns` 基于 `main`；`by-type-injection` 已归档。
- 本变更改 Core：每次改完 Core 都要重建 core dist，再跑 skill 测试。
- 公开仓库：夹具、测试与提交信息里不出现客户、产品或私有语料的名字。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive by-type-injection`（已完成）。
1. `docs(openspec): propose default-file-patterns`：proposal、design、规格增量、tasks。
2. `fix(core): default file patterns no longer exclude directories`：任务 1.1–1.2。
3. `docs(openspec): record default-file-patterns acceptance`：任务 2.1–2.2。

## 1. Core：文件规则不排除目录

- [x] 1.1 按 design D1，在 `packages/core/src/ignore-filter.ts` 里为 `DEFAULT_IGNORE_PATTERNS` 的每条文件规则（不以 `/` 结尾、不以 `!` 开头）派生 `!<规则>/`，接在全部默认规则之后。派生是机械的，不逐条列举；注释写明原因。

  按 design D3 写测试：
  - 每条文件规则的性质测试（同名目录下的文件被选中，同名文件仍是 `filtered-by-defaults`，大小写两种写法）；
  - 规格的每个场景一条测试；
  - 三种快照的一致性。

  绊线：去掉派生后上述测试变红，记下变红的条数。
- [x] 1.2 审计使用者，写下结论，需要改的随本任务一起改：
  - 读 `DEFAULT_IGNORE_PATTERNS` 的代码、文档与测试（含 `scan-project.mjs` 的 `HARD_SKIP_DIRS` 一致性测试、`staleness.ts` 的注释）是否假设列表里只有正向规则；
  - 钉住选择描述符或摘要的测试。

  有变化的钉住值用生成器整块重冻，逐项写明来源。

  完成记录：
  - 派生出 37 条取反规则。导出列表按「文件规则、取反、目录规则」排列，共 105 条，没有重复。
  - 实现时发现：带通配的目录规则可能与文件规则同时匹配一个目录（如 `.trash-1.log/`），取反放在最后会把它放回来，所以目录规则排在最后。已写进 design D1。
  - 绊线：
    - 去掉派生：83 条 core 测试与新适配器文件的 2 条测试变红；
    - 把取反放到最后：4 条 core 测试与 `test_scan_project` 的漂移检查变红。
  - 新测试：
    - `ignore-filter.test.ts` 与 `source-selection.test.ts`：每条文件规则在大写、小写两种写法下的性质测试，以及规格的每个场景；
    - `tests/selection-safety/file-pattern-directories.test.mjs`：三种快照的选中路径与选择摘要一致，Java、PHP、C# 三个文件进入事实图；
    - `test_scan_project` 的漂移检查多覆盖三个与文件规则重名的目录形状。
  - 归档扩展名（`*.zip`、`*.tar`、`*.gz`）的文件由先行的归档判定排除，原因是 `archive`，与改前相同。
  - 1.2 审计结论：
    - 两个使用者保持顺序，处理取反没有问题；
    - 选择描述符逐条带上取反规则；
    - 扫描器的硬跳过目录仍是默认排除的子集；
    - `staleness.ts` 的注释仍准确；
    - 文档里描述用户取反与 CLI 优先级的段落仍准确。
    - 没有测试钉住依赖选择的摘要，没有重冻。仓库里也没有与文件规则重名的目录，没有夹具的选中集合变化。

## 2. 验收与记录

- [ ] 2.1 acceptor 按 design「验收 Oracle」O2–O4 执行，报告放在 `excavator-test-runs/default-file-patterns/`，不进仓库；O6 由我跑。
- [ ] 2.2 在本文件末尾写「验收摘要」，内容为：
  - 候选提交与基线；
  - O1–O6 的结果表；
  - 每个语料的选择差异；
  - 已知限制。

  语料用公开名字，私有语料只写「一个私有 C# 语料」一类的说法。
