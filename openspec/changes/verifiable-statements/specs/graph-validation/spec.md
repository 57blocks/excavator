## Purpose

图合入发布前的核验：锚点行确有该声明，证据行确有该记号，模型层叠加的每条记录要么被接受要么被计数拒绝，摘要经独立核验标注状态；验证器本身先用已知假样本证明它看得见。

## ADDED Requirements

### Requirement: 锚点与证据触源码核对

The validator SHALL read source files. For every `function`/`class` node it SHALL confirm the line at `lineRange[0]` (±1) contains the node's `name` (anonymous classes: the class keyword), else record gap `anchor-mismatch` and set the node's `verification` to `contradicted`. For every `extracted` edge it SHALL confirm the evidence line contains the expected token (callee name for `calls`, target module or specifier for `imports`, symbol name for `exports`, the declaration for `contains`; for model-cited evidence, the name or file of either endpoint), else set the edge's `verification` to `contradicted` and record gap `edge-contradicted`.

#### Scenario: 先验装置——假边与错锚点必被报出
- **GIVEN** a fixture graph into which one `calls` edge with evidence pointing at a line that does not mention the callee, and one node whose `lineRange` is shifted by five lines, have been injected
- **WHEN** the validator runs
- **THEN** it reports exactly one `edge-contradicted` naming that edge and exactly one `anchor-mismatch` naming that node

#### Scenario: 干净图零发现
- **WHEN** the validator runs on the un-injected fixture graph
- **THEN** it reports zero `edge-contradicted` and zero `anchor-mismatch`

### Requirement: 模型叠加层按规则接受或计数拒绝

Merging model overlays onto the facts graph SHALL: attach summaries only to existing node ids (unknown id → reject, gap `overlay-unknown-id`); drop overlay edges that duplicate a facts edge by (source, target, type) (gap `overlay-duplicate-fact`); reject `extracted` overlay edges without evidence (gap `overlay-missing-evidence`); reject `inferred` edges carrying non-model evidence; reject edges with a missing endpoint (gap `overlay-dangling`). Nothing SHALL be dropped without a gap count.

#### Scenario: 五类拒绝各计一
- **GIVEN** an overlay containing one record of each rejected kind and one valid summary and one valid inferred edge
- **WHEN** merge runs
- **THEN** the valid records are present in the merged graph and `gaps` contains each of the five rejection kinds with count 1

#### Scenario: 拒绝计数与日志一致
- **WHEN** merge runs
- **THEN** the sum of rejected records printed by merge equals the sum of `overlay-*` gap counts in the graph

### Requirement: 摘要经独立核验并标注

Every non-empty summary SHALL be checked against the source within its node's `lineRange` by a verifier that receives only the summary, the anchor, and the source slice, and SHALL be marked `verified`, `unverified`, or `contradicted`. A `contradicted` summary SHALL be removed from the node (the node stays), preserved with its reason in an intermediate record, and counted under gap `summary-contradicted`. The graph SHALL record whether verification was full or sampled.

#### Scenario: contradicted 摘要出图
- **GIVEN** a node whose verifier verdict is `contradicted`
- **WHEN** verification is applied
- **THEN** the node's `summary` is empty, `verification` is `contradicted`, and `gaps` contains `summary-contradicted`

#### Scenario: 运行方式可见
- **WHEN** verification ran with sampling of 50 summaries
- **THEN** `project.verification` equals `sample:50`

### Requirement: 引用完整性与领域步骤锚定

The validator SHALL keep all prior structural checks (required node fields, duplicate ids, dangling edge endpoints, layer and tour references) and SHALL require every `step` node to carry `nodeIds` that exist in the graph, or `provenance: "inferred"`; otherwise record gap `step-unanchored`.

#### Scenario: 无 nodeIds 的步骤被计数
- **GIVEN** a domain graph step with neither `nodeIds` nor `provenance: "inferred"`
- **WHEN** the validator runs
- **THEN** `gaps` contains `step-unanchored` naming the step
