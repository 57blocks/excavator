## MODIFIED Requirements

### Requirement: 锚点与证据触源码核对

The validator SHALL read source files. For every `function`/`class` node it SHALL confirm that the node's `name` (anonymous classes: the class keyword) appears either within one line of `lineRange[0]` or on the first line that follows the node's leading lines or, when that line starts with a declaration modifier (`public`, `static`, `final` and the like) and holds only words and types (no parenthesis, brace, semicolon or `=`), on a later line of the same declaration head, else record gap `anchor-mismatch` and set the node's `verification` to `contradicted`. Leading lines are blank lines, comment lines, and annotations, decorators or attributes (including those whose arguments span several lines); skipping them SHALL only move forward from `lineRange[0]` and SHALL stop at the first line that is none of those.

For every `extracted` edge it SHALL confirm the evidence line contains the expected token (for `calls`, the `token` the evidence entry carries when it has one — a JSX element writes the tag name, which an import may have renamed — else the callee name; target module or specifier for `imports`, symbol name for `exports`, the declaration for `contains`; for model-cited evidence, the name or file of either endpoint), else set the edge's `verification` to `contradicted` and record gap `edge-contradicted`. For evidence written by an extractor (not model-cited) that does not name the token its line holds, the token MAY also be found: on the first line that follows the cited line's leading lines (or a later line of a wrapped declaration head, as for anchors), for every edge type except `calls`, whose evidence is the start of an expression and is never an annotation or a comment; and, for `calls`, anywhere in the call expression that starts on the cited line, where the expression ends at the first top-level `;`, at a block body that opens at the top level (a function or a branch is not part of the expression), or at the first line that neither ends in a continuation nor is followed by one. A line ending in `++`, `--`, a nullable type's `?` or a closing comment is not a continuation. Evidence cited by the model SHALL still be checked against the cited line alone.

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

#### Scenario: 修饰符折行的声明被确认
- **GIVEN** a method whose modifiers and return type are on one line and whose name is on the next, with or without an annotation above them
- **WHEN** the validator runs
- **THEN** its anchor and the `contains` and `exports` edges citing its first line are confirmed

#### Scenario: 已写完的声明行不向后看
- **GIVEN** an extractor-written edge whose evidence line is a complete declaration line (it holds a parenthesis or a brace) and whose token appears only on the next line
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`

#### Scenario: 语句行不被当作折行的声明头
- **GIVEN** a Python file whose first line is `import os` and whose third line is `from util import helper`, and a `contains` edge, a `calls` edge and an anchor for `helper` that cite the first line
- **WHEN** the validator runs
- **THEN** all three are contradicted, because a line that does not start with a declaration modifier is not the start of a wrapped head

#### Scenario: 数组字面量的行不被当作属性
- **GIVEN** a node whose range starts at a row of an array literal (`[alpha, 1],`) that is followed by other rows and then a declaration of the node's name more than one line below
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch`; a C# attribute list (`[Serializable, Obsolete]`) is still read as an attribute

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

#### Scenario: 块体不并入表达式
- **GIVEN** an extractor-written `calls` edge whose evidence line opens the body of a function or a branch, with the callee named only inside that body
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`; a callee named on the same line as the opening brace is confirmed

#### Scenario: 模型引用的证据不享受宽容
- **GIVEN** a model-cited `calls` edge whose callee name is on the line after the cited line
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`

#### Scenario: 过长的结构可见而不下结论
- **GIVEN** an extractor-written `calls` edge whose expression runs past the scan bound without a terminator and without the token
- **WHEN** the validator runs
- **THEN** the edge has `verification: "unverified"`, gap `construct-too-long` counts it, and `edge-contradicted` does not
