# hybrid-retrieval Specification

## Purpose

定义 chat 的混合检索：把用户问题（可能是中文业务语言）扩展成代码检索词，从多个来源合并候选，并在预算内做多跳遍历，最终回到事实/源码核实。目标是在空 summary 的 Lazy 图谱上仍能定位并解释代码，且开销有界、结论可核。

## Requirements

### Requirement: 同一次推理内查询扩展

chat SHALL 用**同一次**回答推理把用户问题展开为少量代码检索词（英文术语、常见代码同义词、可能的 identifier），MUST NOT 调度独立的 query-expansion subagent。

#### Scenario: 中文问题扩展出代码词
- **WHEN** 用户用中文问某业务功能
- **THEN** chat 在同一次推理里产出一组英文/代码检索词用于检索，不另起一个扩展 agent

### Requirement: 候选来自多源合并排序

检索候选 SHALL 由以下合并排序：精确 symbol / nodeId / path 命中；`source-index` 的 BM25；SourceSnapshot 的源码搜索；`semantic-cache` 中有效（hash 未过期）的 summary/tags 文本。

#### Scenario: 多源候选合并
- **WHEN** 检索一个查询
- **THEN** 精确命中、BM25、源码搜索与有效语义缓存的候选被合并为一个排序后的候选集

### Requirement: 中文业务问题命中英文代码（召回门）

对中文业务问题面向英文代码，查询扩展 + 检索的 top-20 种子 SHALL 包含人工标注的目标文件或符号（真语料验收，opt-in）。若无 embedding 的词法方案无法达到，方案 SHALL 在本切片内改用向量召回。

#### Scenario: top-20 种子含 gold
- **WHEN** 在标注了 gold 的真实语料上问对应中文业务问题
- **THEN** top-20 检索种子包含该 gold 文件或符号

### Requirement: 有预算的多跳遍历并报告边界

遍历 SHALL 按问题类型选择原语：定位/直接调用者用 1-hop；流程/影响/依赖用有界 BFS（默认最多 4-hop）；明确 A 到 B 用有界最短路（最多 6-hop）。预算 SHALL 为 seed ≤20、扩展节点 ≤80、扩展边 ≤160、交给回答的上下文 ≤12,000 tokens。达到任一预算 SHALL 停止扩展并在回答中说明只覆盖到的边界。遍历 SHALL 优先用确定性边；语义边/domain 只能辅助排序，不能替代源码证据。

#### Scenario: 多跳返回完整确定性路径
- **WHEN** 在 Controller→Service→Handler→EventBus 夹具上问该流程
- **THEN** 在预算内返回这条完整的确定性路径

#### Scenario: 达预算停止并报告
- **WHEN** 遍历触及节点/边/token 任一预算
- **THEN** 停止扩展并在回答里说明覆盖边界

### Requirement: 种子须回源核实

`semantic-cache` 与 domain 命中 SHALL 只作 seed；进入最终回答的每条结论 SHALL 先回到 fact graph 或当前 SourceSnapshot 源码核实。结构类问题 SHALL 直接用事实层回答，MUST NOT 触发语义补充。

#### Scenario: 语义/domain 命中回源核实
- **WHEN** 一个 semantic-cache 或 domain 命中被用于回答
- **THEN** 该结论在进入答案前被 fact graph 或源码证据核实

#### Scenario: 结构问题不触发语义
- **WHEN** 用户问纯结构问题（某类的方法、谁调用谁）
- **THEN** 用事实层直接回答，不做按需语义补充
