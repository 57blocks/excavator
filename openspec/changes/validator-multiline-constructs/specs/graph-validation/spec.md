## MODIFIED Requirements

### Requirement: 锚点与证据触源码核对

The validator SHALL read source files. For every `function`/`class` node it SHALL confirm that the node's `name` (anonymous classes: the class keyword) appears either within one line of `lineRange[0]` or on the first line that follows the node's leading lines, else record gap `anchor-mismatch` and set the node's `verification` to `contradicted`. Leading lines are blank lines, comment lines, and annotations, decorators or attributes (including those whose arguments span several lines); skipping them SHALL only move forward from `lineRange[0]` and SHALL stop at the first line that is none of those.

For every `extracted` edge it SHALL confirm the evidence line contains the expected token (for `calls`, the `token` the evidence entry carries when it has one — a JSX element writes the tag name, which an import may have renamed — else the callee name; target module or specifier for `imports`, symbol name for `exports`, the declaration for `contains`; for model-cited evidence, the name or file of either endpoint), else set the edge's `verification` to `contradicted` and record gap `edge-contradicted`. For evidence written by an extractor (not model-cited) the token MAY also be found: on the first line that follows the cited line's leading lines, for every edge type; and, for `calls`, anywhere in the call expression that starts on the cited line, where the expression ends at the first top-level `;` or at the first line that neither ends in a continuation nor is followed by one. Evidence cited by the model SHALL still be checked against the cited line alone.

When the leading lines of an anchor or the expression of a `calls` edge is longer than the validator's scan bound, the node or edge SHALL be set to `verification: "unverified"` and counted under gap `construct-too-long`; it SHALL be neither confirmed nor contradicted.

#### Scenario: 先验装置——假边与错锚点必被报出
- **GIVEN** a fixture graph into which one `calls` edge with evidence pointing at a line that does not mention the callee, and one node whose `lineRange` is shifted by five lines, have been injected
- **WHEN** the validator runs
- **THEN** it reports exactly one `edge-contradicted` naming that edge and exactly one `anchor-mismatch` naming that node

#### Scenario: 干净图零发现
- **WHEN** the validator runs on the un-injected fixture graph
- **THEN** it reports zero `edge-contradicted` and zero `anchor-mismatch`

#### Scenario: JSX 证据按 token 核对
- **GIVEN** a `calls` edge whose evidence entry has `token: "Btn"`, pointing at the line `return <Btn />;`, to a function node named `Button`
- **WHEN** the validator runs
- **THEN** the edge is not contradicted; pointed at a line that does not contain `Btn`, it is

#### Scenario: 注解在前的声明锚点被确认
- **GIVEN** a method whose `lineRange` starts at `@Override` on the line before its declaration, and a class whose `lineRange` starts at the first line of a three-line annotation with a multi-line argument block, with a comment line between the annotation and the declaration
- **WHEN** the validator runs
- **THEN** both anchors are confirmed and neither is reported as `anchor-mismatch`

#### Scenario: 注解后跟另一个声明时锚点仍被报出
- **GIVEN** a node named `alpha` whose `lineRange` starts at an annotation that precedes a declaration named `beta`
- **WHEN** the validator runs
- **THEN** it reports `anchor-mismatch` for the node

#### Scenario: 错位进方法体的锚点仍被报出
- **GIVEN** a node whose `lineRange` starts five lines inside the body of the preceding declaration
- **WHEN** the validator runs
- **THEN** it reports `anchor-mismatch` for the node, however many annotations the true declaration has

#### Scenario: 成员边的证据行落在注解上被确认
- **GIVEN** `contains`, `exports`, `implements` and `overrides` edges, extractor-written, whose evidence line is an annotation line and whose member name is on the declaration line after it
- **WHEN** the validator runs
- **THEN** none of them is reported as `edge-contradicted`; the same edges with the member name absent from the following declaration line are

#### Scenario: 链式调用跨多行被确认
- **GIVEN** an extractor-written `calls` edge whose evidence line holds the receiver and whose callee name is on the third line of the same chained expression
- **WHEN** the validator runs
- **THEN** the edge is confirmed; with the callee name absent from the expression, or present only in the next statement, it is `edge-contradicted`

#### Scenario: 模型引用的证据不享受宽容
- **GIVEN** a model-cited `calls` edge whose callee name is on the line after the cited line
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`

#### Scenario: 过长的结构可见而不下结论
- **GIVEN** an extractor-written `calls` edge whose expression runs past the scan bound without a terminator and without the token
- **WHEN** the validator runs
- **THEN** the edge has `verification: "unverified"`, gap `construct-too-long` counts it, and `edge-contradicted` does not
