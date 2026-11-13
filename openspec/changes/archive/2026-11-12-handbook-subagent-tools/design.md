## 决定

- **D1 工具清单**（实现时按各提示实际用到的工具核对，用不到的去掉，用到的不许漏）：
  - verifier、priority-judge、remedy-judge、topic-judge：`Read, Write`；
  - tracer：`Read, Grep, Glob, Bash, Write`；
  - writer：`Read, Grep, Glob, Bash, Write, Edit`。
- **D2 writer 的说明只做边界**：收到的提示就是全部任务；只写提示点名的文件；不派子代理；不改 `state.json`。不写任务内容，避免与各阶段的提示重复或冲突。
- **D3 派发文字**：每处派发改成点名代理类型（「a subagent」→「an `excavator-handbook-writer` subagent」），提示正文不动。
- **D4 不写模型**：代理定义没有 `model` 键。

## Oracle

- **O1 合约测试**：每个 `agents/excavator-handbook-*.md` 的 `tools` 恰好等于 D1 的清单，没有 `model`、没有 Agent/Task；skill 目录下的 `.md` 里没有 `general-purpose`；每一处派发句（含 dispatch 与 subagent 的句子）点名一个存在的手册代理类型。先红后绿。
- **O2 启动上下文**：同一个探针提示分别派发改前、改后的每种代理，记下第一轮的上下文 token。改后每种都比改前小。
- **O3 真实冒烟**：在已有运行输出的副本上续跑一个未写完的功能（features 与 findings），写、核对、改引用、追查都走到；没有一个子代理因为缺工具而失败（stderr 与判定文件里没有拒绝工具的记录）。记下每功能花费，与改前一段的平均比较，只作记录不设门槛。
- **O4**：受影响测试、`check-refs`、`openspec validate --all --strict`；全量门在分离检出里跑。
