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

- [x] 2.1 acceptor 按 design「验收 Oracle」O2–O4 执行，报告放在 `excavator-test-runs/default-file-patterns/`，不进仓库；O6 由我跑。
- [x] 2.2 在本文件末尾写「验收摘要」，内容为：
  - 候选提交与基线；
  - O1–O6 的结果表；
  - 每个语料的选择差异；
  - 已知限制。

  语料用公开名字，私有语料只写「一个私有 C# 语料」一类的说法。

## 验收摘要

被测提交 `566bda79`，基线 `28222c55`（与 main 只差 OpenSpec 文档），两者都是 `lazy-fact-graph/12`。

结论：O1–O6 全部通过，没有触发任何预案，没有放宽任何 oracle。

| Oracle | 结论 | 计数 |
|---|---|---|
| O1 单测与绊线 | 通过 | 每条文件规则在大写、小写两种写法下的性质测试，规格的每个场景，三种快照一致并进入事实图。去掉派生时 85 条测试变红；把取反放到最后时 5 条测试变红 |
| O2 选择差异 | 通过 | 本地 25 个语料，两版策略逐文件判定，与不引用 `ignore` 库的独立判定逐一相符。只增不减，变化的判定都从「默认规则排除」变成「选中」。装置先验注入 3 处翻转，全部报出；24 条难例路径（`foo.log/`、`.trash-1.log/`、`node_modules/license/`、私钥头、归档等）产品与独立判定一致 |
| O3 事实 | 通过 | 选择集合变化的两个语料，所有变化都归因到新选中的文件。集合不变的 TomEE examples 与 fineract，节点、边（含证据）、缺口、覆盖、结构行、扫描结果与 import map 都与改前相同，只有选择摘要和每次运行各异的字段不同 |
| O4 真实 MCP | 通过 | Dataverse，全部工具 26 项检查：选中数 2989 → 2992；`recall` 找到 `LicenseServiceBean`（改前找不到）；从它 1 跳入边经 `injects` 到 10 个消费者；`read_evidence` 返回 `@Inject` 行与字段行 |
| O5 耗时 | 不测 | 本变更只改选择集合，不改计算 |
| O6 全量门 | 通过 | core 1417、全仓 3526 通过（4 个跳过与本变更无关），typecheck、`check-refs`、`openspec validate --all --strict` 通过；中间 commit 各自通过 |

每个语料的选择差异：
- Dataverse +3：一个 Java 包里的 3 个文件。
- koel +7：`License/` 目录下的 PHP 文件。
- 一个私有语料目录 +8：
  - 4 个是 C# 源码；
  - 另 4 个是另一个 `license/` 目录下的脚本与许可声明文本。它们不匹配任何默认规则，和 `License.txt` 一样按规格被选中。
  - 提案只数了源码，写的是 4 个。
- 其余 22 个语料：0。

事实变化的归因：
- Dataverse：
  - +50 节点，全部来自新文件；
  - 既有边 0 条删除或改动，新增 341 条边都至少有一端是新节点；
  - 其中 10 条 `injects` 边：10 个既有注入点原来落「仓库外类型」，现在连到 `LicenseServiceBean`，没有一个变成歧义；
  - 1 条 `references` 边：页面里的 EL 名字绑定到 `@Named` 的 bean；
  - 缺口变化逐类归因：
    - 原来 141 个调用点记为「仓库外」，现在连到新文件里的方法；
    - 49 个原来解析不出的 import 现在解析了；
    - 其余新增缺口来自新文件自身的调用点与 import。
- 私有 C# 语料（以含解决方案文件的目录为根）：+11 节点、+10 条边，全部来自 4 个新文件；既有边不变，缺口的变化等于新文件自身的贡献。

已知限制与后续候选：
- 选择摘要对每个项目都变了，每个项目的下一次同步会做一次完整的确定性重投影。
- 目录规则（`out/`、`build/`、`target/` 等）仍会误伤同名的源码包，由后续变更处理（design Non-Goals）。
  - 本次验收证实了它的代价：被排除的仓库内源码会让 Java 调用解析把对它的调用判成「仓库外」。Dataverse 改前就有 141 个这样的调用点，还有 10 个注入点判成「仓库外类型」。
  - 这些判定说的是「肯定在仓库外」，其实是「没读到」。
  - TomEE examples 那个名叫 `out` 的包是自包含的，这次没有触发，但同类问题在别的仓库里会出现。
- O2 的局限：
  - git 语料按 `ls-files --cached --others` 列出，产品读的是 HEAD；
  - 两个多仓库容器按普通目录遍历；
  - 没有语料带生效的项目规则，所以项目规则这一条没有在真实语料上触发，只有单测覆盖。
