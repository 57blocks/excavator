## Purpose

模型仍是图的作者；脚本把带行号的结构事实交给模型，并在合并之后用同一份事实审计模型写出的图：多出的、漏掉的、行号不符的、身份冲突的分别标注与计数，模型内容一条不删；可选地补上模型漏掉的确定性结构边并标明来源。

## ADDED Requirements

### Requirement: 结构事实带行号交给模型

The structural extraction handed to the model SHALL include, per file, functions and classes with `lineRange` and `owner`, imports and exports with line numbers, and call sites with line numbers; the analysis skill SHALL run structural extraction over all scanned files before batching so the same facts are available for auditing.

#### Scenario: 全量结构抽取可用
- **WHEN** an analysis run reaches the batching phase
- **THEN** `intermediate/structure-all.json` exists and covers every file the scanner marked as code

### Requirement: 身份冲突可见但不改 id

The audit SHALL attach `owner` (from the extractor) to function/class nodes and, when two or more declarations in one file with different owners were merged into a single node by the model, SHALL record all owners on that node under `owners` and count the case under gap `identity-collision` with samples. Node ids authored by the model SHALL NOT be rewritten.

#### Scenario: 同名不同接收者的合并被标出
- **GIVEN** a Go file with `func (a *A) Save()` and `func (b *B) Save()` and a model graph containing a single node `function:<path>:Save`
- **WHEN** the audit runs
- **THEN** that node carries `owners: ["A","B"]`, its id is unchanged, and `identity-collision` is 1 for that file

### Requirement: 审计模型图对抽取事实

An audit SHALL derive the expected structural records from the extractors (imports from the import map, exports, containment from declarations, and call sites that resolve to exactly one declaration among the caller's file and its imports) and compare them with the model graph's `extracted` edges: an edge whose evidence line disagrees SHALL be marked `verification: "contradicted"` and counted (`edge-contradicted`); an `extracted` edge with no expected record SHALL be marked `verification: "unverified"` and counted (`edge-unsupported`); an expected record with no edge SHALL be counted under gap `edge-missing` with samples. Declarations without a node SHALL be counted under `node-missing`; nodes of code kinds without a declaration under `node-unsupported`. `inferred` edges SHALL NOT be compared against expected records. Every edge the model wrote SHALL be given `provenance` (`extracted` when an expected record matches, else `inferred`, counted under `edge-auto-inferred`) and no model-written node, edge, or field SHALL be removed or altered. Optionally (default on) the audit MAY append expected `imports`, `exports`, and `contains` records that the model omitted as edges marked `addedBy: "excavator-annotate"`; it SHALL NOT append `calls`. The audit output SHALL be identical across runs on the same inputs.

#### Scenario: 三类差异各计一
- **GIVEN** a fixture graph with one import edge citing the wrong line, one `extracted` calls edge with no call site, and one import present in the import map but absent from the graph
- **WHEN** the audit runs
- **THEN** `edge-contradicted`, `edge-unsupported`, and `edge-missing` each equal 1 and the report names each item

#### Scenario: 模型内容不动
- **GIVEN** any model graph
- **WHEN** the audit runs
- **THEN** every node, edge, and field the model wrote is present and unchanged, and only fields, counts, and `addedBy`-marked edges were added

#### Scenario: 漏节点可见
- **GIVEN** an extractor reporting 12 functions in a file whose graph has 10 function nodes
- **WHEN** the audit runs
- **THEN** `node-missing` is 2 for that file with the two names as samples

#### Scenario: 审计确定
- **WHEN** the audit runs twice on the same graph and extraction outputs
- **THEN** the two reports are byte-identical
