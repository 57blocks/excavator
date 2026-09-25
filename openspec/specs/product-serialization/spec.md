# product-serialization Specification

## Purpose

约束 excavator 把一整份产物序列化成单个文档时的行为：每个整文档产物都报告自己占运行时单字符串上限的比例，让下一道上限在撞上之前就可见；一旦超限，就在改动任何最终产物之前以具名、带确定性数字的错误失败，而不是在发布中途抛出无名的运行时异常。

## Requirements

### Requirement: 整文档产物报告序列化余量

Lazy 运行 SHALL 为它在进程内序列化成单个 JSON 文档的每个产物记录序列化后的字符数，以及该字符数占运行时单字符串上限的百分比。这至少包括 `knowledge-graph.json`、`meta.json`、`source-manifest.json`、Lazy 自己写出的中间产物，以及计算事实摘要时拼出的整份事实文本。该上限 SHALL 取自运行时本身，MUST NOT 写成常量。由子脚本写出的中间产物 SHALL 至少报告其磁盘字节数。余量 SHALL 出现在 Lazy 运行的结果与命令行输出中。

#### Scenario: 成功运行报告每个产物的余量
- **WHEN** 一次 Lazy 首跑成功发布
- **THEN** 运行结果列出每个整文档产物的名称、字符数与占运行时上限的百分比，子脚本产物列出字节数，命令行输出中同样可见

### Requirement: 超限时具名失败且不改动最终产物

当某个整文档产物序列化后的长度超过运行时单字符串上限时，系统 SHALL 以具名错误失败，错误 SHALL 给出产物名、所需字符数与运行时上限。此时 MUST NOT 改动 `.excavator/` 中任何最终产物（`knowledge-graph.json`、source index、fingerprints、meta、manifest），且 MUST NOT 以无名的运行时异常结束运行。

#### Scenario: 产物超限
- **WHEN** 发布时某个整文档产物的序列化长度超过运行时上限
- **THEN** 运行以具名错误失败，错误中含产物名、所需字符数与上限，`.excavator/` 中的最终产物与运行前逐字节相同

#### Scenario: 超限发生在事实摘要阶段
- **WHEN** 计算事实摘要时拼出的整份事实文本超过运行时上限
- **THEN** 运行以同一类具名错误失败，并且不写出任何最终产物
