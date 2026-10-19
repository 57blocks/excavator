## Context

- 失败的那次运行：`run <hadoop> --model sonnet --max-budget-usd 3 --skill-args --estimate`。产物已复制到 `<out>/products/`，随后 `readSample` 抛出 `ERR_STRING_TOO_LONG`，没有 run.report.json。
- 现有 hadoop 图的大小：581–590 MB，头记录一行约 1.4 KB。
- Node 22 的单串上限是 536,870,888 个字符（`buffer.constants.MAX_STRING_LENGTH`）。

### 排查：两个脚本里整个读成字符串的地方

`scripts/benchmark-full-run.mjs` 自己不读 `.excavator` 产物，只经由 `readSample`。`scripts/lib/full-run-report.mjs` 里：

| 读取 | 读的文件 | hadoop 上的大小 | 结论 |
|---|---|---|---|
| `graphNodeCount` | `.excavator/knowledge-graph.jsonl` | 约 590 MB | 超过上限，本变更修 |
| `readJsonIfPresent` | `intermediate/stale-files.json` | 文件路径数组。全仓 16,220 个路径，按 JSON 算约 2.1 MB | 约为上限的 0.4%，不改 |
| `readJsonIfPresent` | `intermediate/batches.json` | 失败那次的副本里 11.8 MB（726 批） | 约为上限的 2.2%，不改 |
| `copyProducts` | 四个产物 | — | `copyFileSync`，不经过字符串 |

两个 JSON 文件本来就要整个解析，不能只读一部分；它们离上限还有约 45 倍以上的余量。

### 不是 `.excavator` 产物、但受同一上限约束的读取

- `runMeasured` 与 `report` 子命令把运行记录 `run.jsonl` 整个读成字符串，再按行解析。
- 实测：hadoop 预估运行的记录 265 KB；cargotracker 的一次 Full（209 个文件）6.8 MB，约每文件 32.6 KB，其中约 80% 是子代理的消息。
- 按每文件线性外推，一次 Full 要约 16,000 个待分析文件才会到上限，这正是整个 hadoop 的规模。
- 上一个变更的预估是整仓 Full 要 $2,409、5,343 次派发，远超两条限制；按 `--scope` 拆成 40–60 次后，每次的记录约 9–13 MB。
- 所以记录的读取本变更不改，作为已知限制写在 Risks 里。

## Goals / Non-Goals

**Goals：**
- 图再大，运行器也能读出样本节点数，写出报告。
- 「只读头记录」由测试钉住，回退到整读时测试变红。

**Non-Goals：**
- 不改运行记录的读取（见 Risks）。
- 不改 `stale-files.json`、`batches.json` 的读取。
- 不改报告的字段与口径。

## Decisions

### D1 同步按块读，不用流

- `readSample` 是同步函数，`runMeasured` 与 `report` 都同步调用它。改成流就要让 `readSample` 变成异步，牵动两个调用方和现有测试。
- 按块读：每块 64 KiB，读到含换行的那一块为止，把换行前的字节拼起来，最后整体解码成 UTF-8。
- 先拼字节再解码，多字节字符跨块时不会被拆坏；换行字节 0x0A 不会出现在多字节 UTF-8 序列里，按字节找换行是安全的。
- hadoop 的头记录约 1.4 KB，一次读取就够。

### D2 头记录不设长度上限

- 头记录的 `fields` 里有项目的语言列表等，长度没有固定上界，定一个上限会把合法的头记录也判成缺失。
- 不设上限：读到换行或文件末尾为止。头记录本身超过单串上限时，解码抛错，被捕获，记为缺失。
- 这类文件只可能是损坏的；它在报告里是可见的一项 `sample:nodes`，不是静默的零。

### D3 读不出来也记为缺失

- 打开、读取、解码、解析，任何一步失败，`graphNodeCount` 都返回 `null`，`readSample` 记 `sample:nodes`。
- 以前打开或读取失败（例如路径是目录、没有权限）会抛出；现在与 `readJsonIfPresent` 对另外两个数的处理一致，也与 `readSample` 的文档「读不出的数记为缺失」一致。
- 打开后的文件描述符在 `finally` 里关闭。

### D4 用注入的读取函数钉住「只读头记录」

- 真实文件系统上，不写一个超过 512 MB 的文件，就分不出「只读了头记录」和「整个读了」。
- `readSample(projectDir, missing, { read })`：`read` 的签名与 `fs.readSync` 相同，默认就是 `fs.readSync`。
- 测试注入的 `read` 每次最多返回 64 字节，并累计字节数：
  - 头记录跨好几次读取，覆盖拼接；
  - 断言节点数正确、读到的字节数大于 0、小于头记录长度加 64，远小于文件大小。
- 旧实现不经过 `read`，计数为 0，测试变红。

## Risks / Trade-offs

- **运行记录。** 一次约 16,000 个文件的 Full 会让 `run.jsonl` 接近单串上限。这样的运行要上千美元、几千次派发，预估会提示超限；真要跑时另立变更，把记录改成按行读、边读边汇总。
- **测试接缝。** `readSample` 多了一个只给测试用的参数。它是可选的，默认值是真实的 `readSync`，两个调用方都不传。

## 验收 Oracle（动手前写死）

- **O1 单元测试与变异。**
  - 新测试：头记录后跟 1 MB 内容，注入的读取函数每次最多 64 字节；断言节点数、读到的字节数在 (0, 头记录长度 + 64) 之内。
  - 新测试：没有结尾换行的头记录照常解析；第一行不是 JSON 时记为缺失。
  - 变异，每种都必须变红：
    - M1 `graphNodeCount` 换回 `readFileSync` 整读；
    - M2 找到换行后不停，一直读到文件末尾；
    - M3 解析失败时返回 0 而不是 `null`。
  - 全量门：vitest、`check-refs`、`openspec validate --all --strict`。
- **O2 真实产物回放，不花钱。**
  - 工作目录：scratchpad 里建一个 `run` 留下的那种目录，样本副本的 `.excavator/knowledge-graph.jsonl` 是指向一个现成 hadoop 图（589 MB）的符号链接，只读。
  - 用一个替身 `claude`：通过 preflight，`-p` 时把失败那次运行的真实记录原样输出。
  - 命令：`node scripts/benchmark-full-run.mjs run --continue <工作目录> --model sonnet --max-budget-usd 1 --out <新目录>`。
  - 通过条件：
    - 进程以 0 退出，写出 run.report.json 与 run.report.md；
    - 报告的 `sample.nodes` 等于另行用 `head -1` 读出的头记录 `counts.nodes`；
    - `missing` 里没有 `sample:nodes`。
  - 先验装置：同样的回放在 `origin/main` 的代码上必须以 1 退出并报 `ERR_STRING_TOO_LONG`，否则这个回放证明不了什么。
  - 同一工作目录再跑一次 `report <记录> --project <样本副本>`，节点数相同。
  - 不过就如实记录，不宣称通过。
