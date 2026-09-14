## Purpose

确定性事实层：把既有结构抽取（structure-all + import-map）投影为事实节点、事实边与覆盖账本，零模型、可复现、缺失可见，且模型输出不得回写。它是 Lazy 首次运行的唯一产物，也是所有语义补充的地基。

## ADDED Requirements

### Requirement: 事实层是零模型的确定性投影

Fact Builder SHALL 仅由 `structure-all` 与 import-map 的结果投影得到事实节点与边，MUST NOT 调用任何模型，MUST NOT 重新解析源码。对同一输入重复运行 SHALL 产出相同的事实投影。

#### Scenario: 构建事实层不调用模型
- **WHEN** 执行 Build Fact Graph
- **THEN** 不发生任何模型调用，且对同一输入重复运行得到相同的事实节点、边、coverage 与 gaps

### Requirement: 支持的事实节点与事实边

事实节点 SHALL 至少覆盖 file、function/method、class/interface 等抽取器可靠支持的声明，以及可确定性识别的配置/路由等非代码节点。事实边 SHALL 至少覆盖 `contains`、`exports`、`imports` 以及**能唯一解析目标**的 `calls`。不能唯一解析的引用 MUST NOT 猜测，SHALL 写入 gap。每条事实边 SHALL 保留 provenance 与源码证据。

#### Scenario: 唯一可解 call 成边，不可解入 gap
- **WHEN** 一处调用能唯一解析到目标节点
- **THEN** 生成一条带 provenance/证据的 `calls` 边；无法唯一解析时改为记入 gap，而不生成猜测的边

### Requirement: Lazy schema 的确定性基础字段

Lazy 事实节点 SHALL 允许 `summary: ""`、`tags: []`、`layers: []`。`complexity` SHALL 按非空代码行数确定性生成：`<50` 为 `simple`、`50–200` 为 `moderate`、`>200` 为 `complex`；阈值固定、可复现、不调用模型。

#### Scenario: complexity 由非空行数确定
- **WHEN** 为一个函数/文件节点计算 complexity
- **THEN** 依据其非空代码行数落入固定阈值分档，且不调用模型

#### Scenario: Lazy 节点语义字段为空或确定性值
- **WHEN** Lazy 首次运行产出事实节点
- **THEN** 其 `summary`/`tags`/`layers` 为空或确定性值，没有任何字段由模型写入

### Requirement: 覆盖账本与 factDigest

事实层 SHALL 产出 `coverage` 与 `gaps`：每个被扫描输入落入恰好一个可见桶，解析失败的文件 SHALL 进入 coverage/gaps，MUST NOT 伪装成"无符号"或"已删除"。事实层 SHALL 产出 `factDigest`，且 `factDigest` SHALL 只覆盖规范化后的事实节点、事实边、coverage 与 gaps，排除 sourceRevision、时间戳、模型名及其他运行元数据。

#### Scenario: 解析失败产生可见 gap
- **WHEN** 某文件解析失败
- **THEN** 它出现在 coverage/gaps 中且带原因，而不是被静默丢弃或伪装成无符号

#### Scenario: factDigest 不含运行元数据
- **WHEN** 同一源码内容以不同时间戳/运行元数据构建两次
- **THEN** 两次得到相同的 factDigest

### Requirement: canonical 事实不可被模型回写

`knowledge-graph.json` 中的确定性节点身份、源码范围、结构边、coverage 与 gaps SHALL 只由确定性投影写入；任何模型输出 MUST NOT 通过 merge/annotate/publish 修改这些字段。无法映射到事实节点的模型输出 SHALL 记为 gap，MUST NOT 创建假锚点。

#### Scenario: 无法映射的模型输出记为 gap
- **WHEN** （后续切片中）某模型输出无法映射到任何事实节点
- **THEN** 记录为一条 semantic gap，而不是新建一个事实锚点
