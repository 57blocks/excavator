## Why

在 hadoop（2014707f8c31，16,220 个文件）上用运行器跑 `--full --estimate`，skill 这一侧的运行成功了，运行器却以 1 退出，没有写出 report.json。

- 收尾时 `readSample` 调 `graphNodeCount` 读样本节点数。`graphNodeCount` 只要 `.excavator/knowledge-graph.jsonl` 的第一行（头记录），却先把整个文件读成一个字符串。
- hadoop 的图约 590 MB，超过 Node 的单串上限 0x1fffffe8（536,870,888 个字符），`readFileSync` 抛出 `ERR_STRING_TOO_LONG`。
- 调用栈：`graphNodeCount` → `readSample` → `runMeasured`。`report` 子命令带 `--project` 时走同一个 `readSample`，也会失败。
- 运行已经花了钱，报告却写不出来；记录还在，但用 `report` 重读也一样失败。

上一个变更 `foreground-fact-build` 的真实验收发现了这个问题，当时注明另立变更修。

## What Changes

- `graphNodeCount` 只读头记录：用 `openSync`/`readSync` 按块读到第一个换行为止，再解码、解析。
- 行为不变：图不存在、头记录解析不出、没有数字型 `counts.nodes` 时返回 `null`，报告里记为缺失 `sample:nodes`；否则返回头记录的 `counts.nodes`。
- 读不出来（包括头记录本身超过单串上限）也记为缺失，与 `readSample` 文档里「读不出的数记为缺失」一致。
- `readSample` 加一个可选参数 `read`，代替 `fs.readSync`，测试用它数读了多少字节。
- 测试钉住「只读头记录」：头记录后面跟着 1 MB 的内容，读到的字节数必须小于头记录加一次读取；旧实现不经过这个读取函数，计数为 0，测试变红。
- 排查两个脚本里其它把 `.excavator` 产物整个读成字符串的地方，结论写进 design.md：都远低于上限，不改。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `full-run-measurement`：新增要求「样本节点数只读图的头记录」。

## Impact

- `scripts/lib/full-run-report.mjs`：`graphNodeCount`、`readSample`。
- `tests/benchmark/test_full_run_report.test.mjs`。
- `scripts/benchmark-full-run.mjs`、skill、core、部署镜像都不变。
