## Context

Full 模式的语义由两个子代理写与查：F2 的文件分析代理为每个事实节点写 `summary`/`displayName`/`tags`，F4 的核验代理对照节点的源码切片给三值判定。两者的输入输出都过确定性脚本：`apply-semantic-patches.mjs` 提交补丁，`apply-verification.mjs` 的 semantic 动作写判定。问题见 proposal：一个 300 节点、上万行的批，分析代理不读源码按名字写，核验代理不读切片判 verified，两个脚本都收下了。

AGENTS.md 的范围闸：能由 skill/prompt 可靠完成的不写进代码。这里散文已经要求读源码，两次真实运行都没守住，所以要落代码的是「机器校验」那一类：脚本能核对的依据。

## Goals / Non-Goals

**Goals:**
- 一个批要读的源码量有确定的上限，而且上限内能读完；
- 每条提交进缓存的 summary，都有分析代理从该节点切片的非声明行原样抄来的一段文字；
- 每条落进缓存的 verified/contradicted 判定，都有核验代理从切片的非声明行原样抄来的一段文字；
- summary 不能是锚点的转写（行号、带目录的路径）。

**Non-Goals:**
- 不判断 summary 说得对不对。依据只证明「看过这一行」，对错仍由核验代理判；
- 不改 Lazy 与 MCP 的 `semantic_commit`（调用方自己读源码，另有契约），不改 Phase 2.5 的 `apply` 动作（增量路径），不改 F4 的分批；
- 不靠「换更强的模型」：所有新检查与模型无关；
- 不做真实运行验收（见风险）。

## Decisions

### D1 F2 的批由脚本按要读的行装

新脚本 `plan-semantic-batches.mjs <projectRoot>`：

- 输入：`intermediate/stale-semantics.json` 的 `plan.generate`、`knowledge-graph.jsonl` 的节点、源码文件（只为数行数，路径收敛在项目根内）。
- 每个节点的 `readRange`：有合法 `lineRange` 用它；没有的（文件节点等）用 `[1, min(行数, 300)]`。读不到的文件、空文件没有 `readRange`，节点进 `unreadable` 桶，不派发，计数可见。
- 装批：节点按 `filePath`、`readRange` 起点、`id` 排序，依次放进当前批；放进去后批的节点数超过 40，或要读的行超过 1,500，就另起一批。要读的行按文件取各节点 `readRange` 的并集再求和，所以类与它的方法、文件头与其中的函数不重复计。单个节点自己超过 1,500 行时独占一批，批上标 `oversized: true`。
- 输出：`intermediate/semantic-batches.json`（每批的序号、节点数、要读的行、是否 oversized，以及 `unreadable` 清单与计数）与每批一个 `intermediate/semantic-input-batch-<i>.json`（`{batchIndex, nodes: [{id, type, name, filePath, lineRange?, readRange}]}`）。
- 两个上限可用 `--max-nodes`、`--max-lines` 调，默认 40 与 1,500。

为什么取代 `compute-batches.mjs`：F2 的派发从不传 `neighborMap` 与 `batchImportData`，Louvain 分组只决定了哪些文件在一起；改按路径排序，同目录的文件仍相邻。`compute-batches.mjs` 本身不动，Phase 1.5 仍用它。

为什么是 40 与 1,500：宿主的读文件工具一次返回至多 2,000 行，1,500 行的切片加上提示与输出在一个子代理里读得完；40 个节点约是旧分批每批节点数的一半到三分之二。这是起点，不是测出来的最优值，所以做成参数。

为什么文件节点只读前 300 行：文件级 summary 讲文件是什么，文件头的导入与顶层声明足够；整份 2,000 行的文件让文件节点独占一批，等于把整份文件再读一遍。

### D2 补丁依据：一行号加一段原文

补丁形状加 `evidence: {line, quote}`。`read-evidence.mjs` 的 `checkReadEvidence` 按顺序查，第一条不过就给出对应的状态：

| 状态 | 条件 |
|---|---|
| `evidence-missing` | 没有 `evidence`，或 `line` 不是正整数，或 `quote` 不是单行字符串 |
| `evidence-source-unreadable` | 源文件读不到或在项目根外 |
| `evidence-line-outside-range` | `line` 不在 `readRange` 里 |
| `evidence-declaration-line` | 节点有多行 `lineRange` 而 `line` 是它的第一行 |
| `evidence-quote-trivial` | `quote` 去掉空白后不含字母或数字，或少于 `min(8, 该行去掉空白后的字符数)` 个字符 |
| `evidence-quote-not-on-line` | 空白折叠后，`quote` 不是该行的子串 |

全部通过才算有依据。不过的补丁不提交，记为 `semantic-patch-evidence-invalid` gap，结果行带具体状态。依据不写进缓存：它是提交闸的输入，不是语义。

为什么排除声明行：函数名、参数、`function`/`def` 关键字都在第一行，凭节点清单就能猜出原文，观察到的核验回复正是「只拿函数名对了一下」。

### D3 summary 不转写锚点

`citesAnchor(text, node)` 对 summary 与 `displayName` 各查一次，命中任一即拒：

- `\blines?\s+\d+`（`line 12`、`lines 12-31`）；
- `<文件名>.<扩展名>:<数字>`（`orders.js:120`）；
- 节点自己的 `filePath`，且它含 `/`（带目录的路径；根目录下的文件名不算，文件节点的 summary 提到自己的名字是正常的）。

命中记为 `semantic-patch-cites-anchor` gap。只查形式，与 D2 互补：D2 管「读没读」，D3 管观察到的那种模板残留。

没有选「summary 复述 displayName 就拒」：复述不是编造，D2 已经要求读过源码。

### D4 核验判定的依据

核验代理对 `verified` 与 `contradicted` 输出同样的 `evidence`，规则同 D2，`readRange` 就是节点的 `lineRange`（F4 只选有 `lineRange` 的节点）。`applySemanticVerification` 新增必填参数 `checkEvidence(entry)`，缺了就抛错（不默认放行）。CLI 用事实图的锚点与项目根内的源码读取器构造它。

不合格的判定：

- 计入 `verdictNoEvidence` 与 `semantic-summary-verdict-no-evidence` gap，不写入；
- 逐批提交时该 id 保持未判，下次运行再选；
- 收尾时与「没有判定」一样记为 `unverified`，但计在 `verdictNoEvidence` 而不是 `verdictMissing`。

`unverified` 不需要依据：它是保守的一档，文件缺失、切片为空时也只能是它。

### D5 编排与散文

- SKILL.md F2 第 2 步改为运行 `plan-semantic-batches.mjs`；`--estimate` 停在它之后；第 3 步派发时把输入文件路径给分析代理，不再由编排者拼节点清单；`unreadable` 节点作为 gap 报告。F1 之前清理的文件模式加上 `semantic-input-batch-*.json`。
- 预估附录的 `B2` 改读 `semantic-batches.json` 的 `totalBatches`，并写明每批费率是在旧分批上测的。
- 基准报告脚本 `scripts/lib/full-run-report.mjs` 的 F2 批数与产物清单改读 `semantic-batches.json`。
- 文件分析代理的 Semantic Patch Mode 与核验代理的 Output 写明 `evidence` 的形状与规则，并说明不合格的会被脚本丢弃。

## Risks / Trade-offs

- **依据只证明看过一行。** 代理可以抄一行再照样按名字写。剩下的由核验代理判，而核验代理的 verified 也要依据。两层都只是地板。
- **可猜的非声明行。** 带注解或装饰器的节点，声明在第二行，仍可能被猜中；`return null;` 之类的短行也可能被猜中。这是残余，不再加规则。
- **覆盖会降。** 读不到依据的节点（空文件、只有标点的函数体）进 gap。按「编造零容忍、覆盖缺口可见即可」处理。
- **花费上升。** 批数变多。旧的低价来自没读源码。
- **没有真实运行。** 本变更只用单元测试与脚本级测试验收，没在观察到问题的语料上重跑，矛盾率是否下降未测。

## 验收 oracle（动手前写死）

- **O1 先红后绿。** 每个新检查（D1 的两个上限与 oversized、D2 的每个状态、D3 的三种形式、D4 的不写入与收尾记 `unverified`、`checkEvidence` 缺失时抛错）都有一个测试，先在未实现的代码上跑红，再实现后跑绿。红的输出记进验收记录。
- **O2 变异。** 实现后逐个关掉 D2 的声明行规则、D2 的子串比较、D3、D4 的依据检查、D1 的行数上限，各自至少一个测试变红，然后还原。
- **O3 门。** 本地跑受影响的测试（`tests/full/`、`tests/semantic-cache/`、`tests/lazy/lazy-to-full-e2e`、`tests/mcp/cross-channel`、`tests/skill/excavator/`、`tests/benchmark/test_full_run_report`）与 `node scripts/check-refs.mjs`、`openspec validate --all --strict`；全量交 CI，`CI gate` 与 `Privacy scan` 都绿。
- **O4 隐私与语言。** 分支改动的代码、散文、测试零中文字符；代码、测试、spec、PR 不出现语料或客户的名字。
