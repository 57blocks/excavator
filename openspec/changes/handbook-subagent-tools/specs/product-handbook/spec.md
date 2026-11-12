## ADDED Requirements

### Requirement: 子代理的工具

手册派发的每个子代理 SHALL 使用插件里的手册代理类型之一，SHALL NOT 使用 general-purpose 或其他不限工具的类型。每个手册代理定义 SHALL 写明 `tools`，只列出它的任务需要的工具：
- 核对代理与评判代理：读文件、写自己的判定文件；
- 追查代理：读文件、搜索、只读命令、写自己的判定文件；
- 写作代理 `excavator-handbook-writer`：读文件、搜索、命令、写与改自己的产物文件。

手册代理 SHALL NOT 拿到派发子代理的工具。代理定义 SHALL NOT 指定模型。

#### Scenario: 运行环境装了很多 MCP 工具

- **WHEN** 运行环境里有几十个 MCP 工具，手册派发一个核对代理
- **THEN** 这个核对代理只拿到读文件和写文件两个工具，启动上下文里没有其他工具的说明

#### Scenario: 写条目

- **WHEN** 编排者为一个功能派发条目通道
- **THEN** 它派发的是 `excavator-handbook-writer` 类型，提示与原来相同

#### Scenario: 派发文字

- **WHEN** 检查 skill 的各阶段文字
- **THEN** 每一处派发子代理的文字都点名一个手册代理类型，没有一处写 general-purpose
