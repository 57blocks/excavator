## MODIFIED Requirements

### Requirement: 锚点与证据触源码核对

The validator SHALL read source files. For every `function`/`class` node it SHALL confirm that the node's `name` (anonymous classes: the class keyword) appears either within one line of `lineRange[0]` or on the first line that follows the node's leading lines, else record gap `anchor-mismatch` and set the node's `verification` to `contradicted`. Leading lines are blank lines, comment lines, and annotations, decorators or attributes, including those whose arguments span several lines. A bracket attribute has to close with `]`; an assignment such as `@count = 0` or `@@total += 1`, and a statement that starts with `*` as in `*p = 1;`, is not a leading line. Skipping leading lines SHALL only move forward from `lineRange[0]` and SHALL stop at the first line that is none of those.

For every `extracted` edge it SHALL confirm the evidence line contains the expected token (for `calls`, the `token` the evidence entry carries when it has one — a JSX element writes the tag name, which an import may have renamed — else the callee name; target module or specifier for `imports`, symbol name for `exports`, the declaration for `contains`; for model-cited evidence, the name or file of either endpoint), else set the edge's `verification` to `contradicted` and record gap `edge-contradicted`. An edge written by an extractor whose evidence entry does not name the token its line holds, and which is not a `calls` edge, is also confirmed when the cited line is the first line of the range of an endpoint whose name is the expected token and whose own anchor is confirmed exactly: the name is on `lineRange[0]` itself or on the first line after its leading lines, not only within one line of it. This is decided from the graph, not from how the cited line reads, so a cited line that is any other line is not confirmed by it. Evidence cited by the model SHALL still be checked against the cited line alone.

When the leading lines of an anchor are longer than the validator's scan bound, the node SHALL be set to `verification: "unverified"` and counted under gap `construct-too-long`; it SHALL be neither confirmed nor contradicted.

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
- **GIVEN** a method whose `lineRange` starts at `@Override` on the line before its declaration, a class whose `lineRange` starts at the first line of an annotation block of more than twenty lines with nested annotations and string literals that hold brackets, `@` and `\n`, and, in other languages, a decorator, a C# attribute and a Rust attribute above their declarations, with a comment line between an annotation and its declaration in some of them
- **WHEN** the validator runs
- **THEN** every one of those anchors is confirmed and none is reported as `anchor-mismatch`

#### Scenario: 注解后跟另一个声明时锚点仍被报出
- **GIVEN** a node named `alpha` whose `lineRange` starts at an annotation that precedes a declaration named `beta`
- **WHEN** the validator runs
- **THEN** it reports `anchor-mismatch` for the node

#### Scenario: 错位进方法体的锚点仍被报出
- **GIVEN** a node whose `lineRange` starts five lines inside the body of the preceding declaration
- **WHEN** the validator runs
- **THEN** it reports `anchor-mismatch` for the node, however many annotations the true declaration has

#### Scenario: 语句形状的行不被当作前导行
- **GIVEN** a node whose `lineRange` starts at a statement of some language (`import os`, `export default router`, `from util import *`, `count--`, `val x: String?`, `@count = 0`, `@@total += 1`, `*p = 1;`, an array row such as `[make(1), 2],`, also written over two lines), written twice in a row and followed by a declaration of the node's name
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch`; a comment line, and a C# attribute list such as `[Serializable, Obsolete]`, are still leading lines

#### Scenario: 边只在引用端点自己范围的第一行时被确认
- **GIVEN** `contains` edges to a method whose range starts at its annotation, one citing that first line, one citing a line inside the method that does not hold its name, and one citing the first line of another member
- **WHEN** the validator runs
- **THEN** only the first is confirmed; and an edge citing the first line of a member whose own anchor does not hold is contradicted

#### Scenario: 靠 ±1 容差才通过的锚点不替边担保
- **GIVEN** a node whose `lineRange` starts one line above or one line below its declaration, so that its anchor passes only within one line, and `contains` and `exports` edges citing that same first line
- **WHEN** the validator runs
- **THEN** the anchor is confirmed as before, and the edges are contradicted; when the range starts exactly on the declaration they are confirmed

#### Scenario: 语句形状的行不被当作声明起点
- **GIVEN** a statement of some language on the first line and a declaration of `helper` on the line after it, and `contains` and `exports` edges to `helper` that cite the first line
- **WHEN** the validator runs
- **THEN** both edges are `edge-contradicted`

#### Scenario: 模型引用的证据不享受宽容
- **GIVEN** a model-cited edge whose cited line is the first line of an endpoint's range with the expected name on the line after it
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`

#### Scenario: 过长的前导行可见而不下结论
- **GIVEN** a node whose `lineRange` starts at an annotation that opens a bracket and never closes within the scan bound
- **WHEN** the validator runs
- **THEN** the node has `verification: "unverified"`, gap `construct-too-long` counts it, the CLI summary line and `validation.json` carry the count, and `anchor-mismatch` does not
