## Purpose

知识图中每条边、每个节点摘要、每个覆盖数字的归因契约：边有来源与证据，摘要有核验状态，图有覆盖表与缺口表，项目有事实与源码的 digest；schema 校验不得剥掉这些字段。

## ADDED Requirements

### Requirement: 每条边声明来源与证据

Every edge SHALL carry `provenance` ∈ {`extracted`, `inferred`} and `evidence: Evidence[]` where `Evidence = {file, line, endLine?, source ∈ {tree-sitter, import-map, rule, model}, text?}`. An `extracted` edge SHOULD have at least one evidence entry; an `inferred` edge SHOULD NOT carry evidence whose `source` is not `model`. Violations SHALL be reported by the shape audit (`auditGraphShape`) and SHALL NOT cause validation to reject the graph, so that graphs produced by the unmodified UA pipeline still load. `weight` SHALL remain a per-edge-type constant used only for ordering and SHALL be documented as such.

#### Scenario: extracted 边缺证据被审计标出
- **WHEN** a graph containing an edge with `provenance: "extracted"` and empty `evidence` is validated and shape-audited
- **THEN** validation accepts the graph and the shape audit reports `extracted-edge-without-evidence` naming the edge

#### Scenario: inferred 边带非模型证据被审计标出
- **WHEN** an edge has `provenance: "inferred"` and an evidence entry with `source: "tree-sitter"`
- **THEN** the shape audit reports `inferred-edge-with-nonmodel-evidence` for that edge

#### Scenario: 新字段经校验后仍在
- **WHEN** a graph whose edges carry `evidence`, `provenance` and whose root carries `coverage`, `gaps` passes through the graph validator
- **THEN** the returned graph still contains every one of those fields unchanged

### Requirement: 节点锚点按类型必填并可核验

`function` and `class` nodes SHOULD have `filePath` and `lineRange`; `file`, `config`, `document` nodes SHOULD have `filePath`; missing anchors SHALL be reported by the shape audit as `missing-file-anchor` / `missing-line-anchor` and SHALL NOT cause validation to reject the node. Structural nodes SHALL carry `anchorSource` ∈ {`tree-sitter`, `rule`, `census`} and MAY carry `owner`. `summary` MAY be empty. A node with a summary MAY carry `verification` ∈ {`verified`, `unverified`, `contradicted`, `dirty`}.

#### Scenario: 缺锚点的函数节点被审计标出
- **WHEN** a `function` node without `lineRange` is validated and shape-audited
- **THEN** validation accepts the node and the shape audit reports `missing-line-anchor` for it

#### Scenario: 空摘要合法
- **WHEN** a `function` node has `summary: ""` and no `verification`
- **THEN** validation accepts the node

### Requirement: 图级覆盖表、缺口表与 digest

The graph root SHALL carry `coverage` (per language: files, parsed, zeroSymbol, skipped by reason, counts per kind) and `gaps: Gap[]` with `Gap = {kind, scope, reason, count, samples?}`. `project` SHALL carry `sourceDigest` (sha256 of the scanned sources), `factsDigest` (sha256 of the canonical deterministic facts graph), `pipelineVersion`, `model` (host-reported model name or `unknown`), and `gitCommitHash: string | null`.

#### Scenario: 非 git 目标有 digest 无 commit
- **WHEN** a project without a git repository is analysed
- **THEN** `project.gitCommitHash` is `null` and `project.sourceDigest` is a 64-hex sha256

#### Scenario: 旧格式图仍可校验
- **WHEN** a graph lacking `coverage`, `gaps`, `evidence` and `provenance` (the pre-v2 shape) is validated
- **THEN** it is accepted and reported as legacy shape, with `coverage` and `gaps` defaulted to empty
