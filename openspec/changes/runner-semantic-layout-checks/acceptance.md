## 验收记录

对象：一个 74 文件的 Java 切片，本机 runner（工作树里的插件），Sonnet 5.5；产物取自一次真实的 `full`。每一项都在产物的副本上做，原件不动。

| 检查 | 修复前 | 修复后 |
|---|---|---|
| 完整性（校验器，层来自 `semantic-graph.json`） | 74 个问题，全是「文件节点不在任何层」 | 0 个问题 |
| 产物检查（模型名读 `semantic-graph.json`） | 读事实图，恒为 null | `claude-sonnet-5-5` 通过；改成 `unknown` 失败，原因写明文件名 |
| 已有 full 产物上再跑 `full` | 旧代码不认它是 full 产物 | 跳过，退出码 0，花费 0 |
| 只删 `semantic-graph.json` 后跑 `full`（摘要缓存保留，只重做 F3） | 退出码 4 | 退出码 0；load、run、product、integrity、fabrication 五项都通过；语义图 `model` 为 `claude-sonnet-5-5`，6 层，0 缺口；估算花费 $1.56，约 2 分钟 |
| 紧接着再跑一次 `full` | — | 跳过，退出码 0，花费 0，`.excavator/` 里 81 个文件的摘要值前后相同 |

没有覆盖的：编造闸仍不数摘要校验里的矛盾（本变更不改）；Bedrock 路径上的同一套检查（任务 3.5，合并后在 EC2 上做）；F3 写模型名这一行只在运行器只设了 `ANTHROPIC_MODEL` 的条件下验过，没有验 `EXCAVATOR_MODEL` 也设置的情况（只有单元用例）。
