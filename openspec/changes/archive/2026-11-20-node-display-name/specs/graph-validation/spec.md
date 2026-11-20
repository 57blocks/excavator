## MODIFIED Requirements

### Requirement: 摘要经独立核验并标注

Every non-empty summary SHALL be checked against the source within its node's `lineRange` by a verifier that receives only the summary, the node's `displayName` when it has one, the anchor, and the source slice, and SHALL be marked `verified`, `unverified`, or `contradicted`. One verdict covers both texts: if either the summary or the `displayName` asserts something the slice contradicts, the verdict SHALL be `contradicted` and its reason SHALL say which text is contradicted. Consumers that drop a `contradicted` summary SHALL drop its `displayName` with it. A `contradicted` summary SHALL stay on the node with `verification: "contradicted"`, SHALL be recorded with its reason in an intermediate file, and SHALL be counted under gap `summary-contradicted`; consumers decide how to treat it. The graph SHALL record whether verification was full or sampled.

#### Scenario: contradicted 摘要出图
- **GIVEN** a node whose verifier verdict is `contradicted`
- **WHEN** verification is applied
- **THEN** the node keeps its summary text, `verification` is `contradicted`, the intermediate record holds the reason, and `gaps` contains `summary-contradicted`

#### Scenario: 运行方式可见
- **WHEN** verification ran with sampling of 50 summaries
- **THEN** `project.verification` equals `sample:50`

#### Scenario: 名称与源码矛盾
- **GIVEN** a cache entry whose summary matches the slice but whose `displayName` is `Delete project`, while the slice only reads a project
- **WHEN** verification is applied
- **THEN** the verdict is `contradicted`, the reason names the `displayName`, and the viewer payload carries neither the summary nor the `displayName` for that node
