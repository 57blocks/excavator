## MODIFIED Requirements

### Requirement: 持久化模型语义统一使用英文

写入 `.excavator` 的模型生成语义文本 SHALL 使用英文，包括 semantic cache 的 summary/displayName/tags、semantic graph 的架构描述/layers，以及 domain graph 的领域、流程、步骤与说明；这些产物 SHALL 带有由确定性写入方控制的 `contentLanguage: "en"`。源码标识符、文件路径、代码字符串、专有名称与逐字源码证据 MUST 保持原文，且 MUST NOT 为满足英文规则而改写。

#### Scenario: 中文问题生成英文语义
- **WHEN** 用户用中文提出需要按需语义的问题
- **THEN** 新写入的模型 summary/displayName/tags 为英文并带有 `contentLanguage=en`，源码标识符与逐字证据保持原文

#### Scenario: 非英文模型语义拒绝持久化
- **WHEN** 待提交的模型解释性文本明显不是英文或无法声明规范英文
- **THEN** 该语义进入可见 rejected/gap 桶且不修改规范语义产物或事实图

#### Scenario: 原文技术标识不算混语
- **WHEN** 英文解释引用非英文源码标识符、字符串字面量或专有名称
- **THEN** 系统只遮罩从当前事实图或 SourceSnapshot 精确匹配到的 source-owned span，再审计剩余模型解释；它保留原文且不接受模型自行声明的豁免
