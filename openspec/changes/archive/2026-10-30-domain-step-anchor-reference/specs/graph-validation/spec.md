## MODIFIED Requirements

### Requirement: 引用完整性与领域步骤锚定

The validator SHALL keep all prior structural checks (required node fields, duplicate ids, dangling edge endpoints, layer and tour references) and SHALL require every `step` node to carry `nodeIds` that exist in the graph, or `provenance: "inferred"`; otherwise record gap `step-unanchored`.

A step's `nodeIds` name nodes of the knowledge graph, which a domain graph does not contain. When the validator is given a reference graph, a step's `nodeIds` SHALL resolve against the nodes of the validated graph and of the reference graph together; without one, against the validated graph alone. Every `step` node SHALL be counted in exactly one of three buckets, and the report SHALL give all three and the number of steps: anchored (at least one `nodeIds` entry resolves), inferred (none resolves and it is marked `provenance: "inferred"`), unanchored (neither; gap `step-unanchored`). The three SHALL add up to the number of steps. A reference graph that is named but cannot be read SHALL fail the run rather than leave every anchored step unanchored.

The layer checks (a layer references only existing nodes, a node is in at most one layer, every file node is in a layer) read the layers of the graph. When the graph has no layers at all, they SHALL read the `layers` of `semantic-graph.json` in the same directory as the graph file, because Full writes the layers there and not into the fact graph. A `semantic-graph.json` that is missing, unreadable, or has no layers leaves the layers empty, so the file nodes are still reported as not in any layer: nothing passes because the layers could not be found.

#### Scenario: 无 nodeIds 的步骤被计数
- **GIVEN** a domain graph step with neither `nodeIds` nor `provenance: "inferred"`
- **WHEN** the validator runs
- **THEN** `gaps` contains `step-unanchored` naming the step

#### Scenario: 步骤锚定在知识图谱里
- **GIVEN** a domain graph whose step's `nodeIds` name a node that is in the knowledge graph and not in the domain graph
- **WHEN** the validator runs with that knowledge graph as the reference graph
- **THEN** the step is counted as anchored, not unanchored, and anchored, inferred and unanchored add up to the number of steps

#### Scenario: 没有参照图
- **GIVEN** the same domain graph
- **WHEN** the validator runs without a reference graph
- **THEN** the step is counted as unanchored with the reason that none of its `nodeIds` exist in the graph

#### Scenario: 参照图读不到
- **WHEN** the validator is given a reference graph path that does not exist or is not a graph
- **THEN** it exits non-zero naming the path and writes no report

#### Scenario: 层在语义图里
- **GIVEN** a fact graph with file nodes and no layers, and a `semantic-graph.json` next to it whose layers put every file node in exactly one layer
- **WHEN** the validator runs
- **THEN** it reports no layer issue; if the same layers reference a missing node, put a node in two layers, or leave a file node out, each is reported as it is for a graph with its own layers

#### Scenario: 语义图读不到时不静默通过
- **GIVEN** a fact graph with file nodes and no layers, and no `semantic-graph.json` next to it, or one that is not valid JSON, or one with no layers
- **WHEN** the validator runs
- **THEN** every file node is reported as not in any layer

#### Scenario: 图自带层时不读语义图
- **GIVEN** a graph that has its own layers and a `semantic-graph.json` next to it whose layers differ
- **WHEN** the validator runs
- **THEN** only the layers of the graph are checked
