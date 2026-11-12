## MODIFIED Requirements

### Requirement: 审计模型图对抽取事实

An audit SHALL derive the expected structural records from the extractors (imports from the import map, exports, containment from declarations, and call sites that resolve to exactly one declaration among the caller's file and its imports) and compare them with the model graph's `extracted` edges: an edge whose evidence line disagrees SHALL be marked `verification: "contradicted"` and counted (`edge-contradicted`); an `extracted` edge with no expected record SHALL be marked `verification: "unverified"` and counted (`edge-unsupported`); an expected record with no edge SHALL be counted under gap `edge-missing` with samples. A `calls` edge SHALL match a call record only if, when the caller file's call sites of that callee resolve to exactly one declaration (by the scope of 「审计的期望调用记录用事实图的调用作用域」), its target node is in that declaration's file. An edge that names the callee but targets any other node, a node with no file included, SHALL get no evidence line, SHALL be treated as an edge with no expected record, SHALL be counted under gap `edge-target-mismatch` (scope `calls`) with samples naming the edge, the call line and the one file in scope that declares the callee, and MUST NOT keep that call site out of `edge-missing`. Sites that are ambiguous or unresolved SHALL match by caller file and callee name. Declarations without a node SHALL be counted under `node-missing`; nodes of code kinds without a declaration under `node-unsupported`. A model-written `inferred` edge that no expected record matches SHALL keep `inferred` and SHALL NOT be counted under `edge-unsupported` or `edge-auto-inferred`. Every edge the model wrote SHALL be given `provenance` (`extracted` when an expected record matches, else `inferred`, counted under `edge-auto-inferred`) and no model-written node, edge, or field SHALL be removed or altered. Optionally (default on) the audit MAY append expected `imports`, `exports`, and `contains` records that the model omitted as edges marked `addedBy: "excavator-annotate"`; it SHALL NOT append `calls`. The audit output SHALL be identical across runs on the same inputs.

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

#### Scenario: 指向别处同名声明的边不算匹配
- **WHEN** `app.ts` 导入 `./helper` 并调用 `helper()`，`other.ts` 也声明了 `helper` 但 `app.ts` 没有导入它，模型画了 `run → other.ts#helper`，没写 `provenance`
- **THEN** 这条边没有证据行，`provenance` 记 `inferred` 并计入 `edge-auto-inferred`；`edge-target-mismatch` 计 1，样本写出 `src/helper.ts`；`edge-missing` 的 `calls` 计入这个调用点

#### Scenario: 对的边与错的边都在时只报错的边
- **WHEN** 同一情形下模型同时画了 `run → helper.ts#helper` 与 `run → other.ts#helper`
- **THEN** 前者照旧 `extracted` 并带调用行，后者计入 `edge-target-mismatch`，这个调用点不计入 `edge-missing`

#### Scenario: 有歧义的调用点照旧按名字匹配
- **WHEN** `app.ts` 同时导入 `./helper` 与 `./other`，两者都声明 `helper`，模型画了 `run → other.ts#helper`
- **THEN** 这条边照旧得到 `extracted` 与调用行，不计入 `edge-target-mismatch`
