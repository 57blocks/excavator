# graph-validation Specification

## Purpose
图合入发布前的核验：锚点行确有该声明，证据行确有该记号，模型层叠加的每条记录要么被接受要么被计数拒绝，摘要经独立核验标注状态；验证器本身先用已知假样本证明它看得见。

## Requirements

### Requirement: 锚点与证据触源码核对

The validator SHALL read source files. For every `function`/`class` node it SHALL confirm that the node's `name` (anonymous classes: the class keyword) appears either within one line of `lineRange[0]` or on the first line that follows the node's leading lines, else record gap `anchor-mismatch` and set the node's `verification` to `contradicted`. A leading line holds nothing but blank space, comments, and annotations, decorators or attributes, including those whose arguments span several lines. A line that holds anything else once those are read off its start is the start of the construct and not a leading line: a statement, an annotation followed by a declaration on the same line, a comment followed by code, an array row after a bracket. Which annotation and attribute syntaxes exist is decided by the extension of the file: `@` annotations and decorators in Java, Kotlin, Scala, Groovy, Swift, Dart, TypeScript, JavaScript and Python files; `[Name]` attributes in C# files; `#[...]` attributes in Rust and PHP files; `//` line comments and block comments in the C family files (Java, Kotlin, Scala, Groovy, Swift, Dart, TypeScript, JavaScript, C#, Rust, PHP, Go, C and C++); `#` comments in Python, Ruby, shell, Perl, R, Elixir and PHP files. A file of any other language has no annotation, attribute or comment syntax, and blank lines are the only leading line every language has. A line that starts with `*` or `//` in a Python or Ruby file is the continuation of an expression, and a line that starts with `*` is not read as the continuation of a block comment in any language. Skipping leading lines SHALL only move forward from `lineRange[0]` and SHALL stop at the first line that is none of those.

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
- **GIVEN** a node whose `lineRange` starts at a statement of some language (`import os`, `from util import *`, `count--`, `export default router`, `*p = 1;`, a Ruby `@log.info(item)` or `@count = 0`, a JavaScript or Python `[a, b] = [b, a]`, an array row such as `[make(1), 2],`, a C preprocessor line `# define X 1`, an `@interface` declaration), written twice in a row and followed by a declaration of the node's name
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch`

#### Scenario: 前导行带着别的内容就不是前导行
- **GIVEN** a node whose `lineRange` starts at a line that is an annotation followed by a declaration (`@Override public void other() {}`), an attribute followed by a declaration, or a block comment followed by code (`/* note */ int x = 1;`, `*/ int x = 1;`), written twice in a row and followed by a declaration of the node's name
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch`

#### Scenario: 注解与属性的语法由文件的语言决定
- **GIVEN** the text `@Override` in a Ruby, PHP or unrecognised file, `[Serializable]` in a JavaScript, Java or unrecognised file, `#[derive(Debug)]` in a Java, C# or unrecognised file, `// note` or `/* note */` in a Python, Ruby, shell or unrecognised file, and `# note` in a Java, C or Rust file, written twice in a row and followed by a declaration of the node's name
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch`; the same text in a file of a language that has that syntax (`@Override` in Java, `[Serializable, Obsolete]` in C#, `#[derive(Debug)]` in Rust, `# note` and `// note` in PHP, `// note` in Go, a trailing comment after an annotation) is a leading line

#### Scenario: 表达式的续行不被当作注释
- **GIVEN** a Python file whose lines are `x = (a`, `* b`, `* c)` and `def helper():`, a node `helper` whose `lineRange` starts at the second line, and a `contains` edge that cites that line
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch` and the edge as `edge-contradicted`; the same holds for a continuation line that starts with `//`, in Python, and with `*`, in Ruby and in C (`* p = 1;`)

#### Scenario: 起点落在注释中间的范围被报出
- **GIVEN** a node whose `lineRange` starts at the middle of a block comment that precedes its declaration
- **WHEN** the validator runs
- **THEN** the anchor is reported as `anchor-mismatch`; a block comment that opens and closes among the leading lines is still read, and one whose closing line carries code is not

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

### Requirement: 无证据的边可见而不丢弃

The pipeline SHALL keep the model as the author of the graph. Any model-written edge that no extractor record supports SHALL remain in the graph with `provenance: "inferred"` and be counted under `edge-auto-inferred`; any evidence the model cites that disagrees with the extractor record SHALL be corrected to the extractor line and counted under `evidence-corrected`. Nothing SHALL be dropped without a count, and the counts printed by the annotate step SHALL equal the corresponding gap counts in the graph.

#### Scenario: 注入的无证据边被标出而不删
- **GIVEN** a batch output with one edge that has no evidence and no extractor record
- **WHEN** annotate runs
- **THEN** the edge is present with `provenance: "inferred"` and `edge-auto-inferred` is 1

#### Scenario: 计数与日志一致
- **WHEN** annotate runs
- **THEN** the totals it prints equal the sums of the corresponding gap counts in the graph

### Requirement: 摘要经独立核验并标注

Every non-empty summary SHALL be checked against the source within its node's `lineRange` by a verifier that receives only the summary, the anchor, and the source slice, and SHALL be marked `verified`, `unverified`, or `contradicted`. A `contradicted` summary SHALL stay on the node with `verification: "contradicted"`, SHALL be recorded with its reason in an intermediate file, and SHALL be counted under gap `summary-contradicted`; consumers decide how to treat it. The graph SHALL record whether verification was full or sampled.

#### Scenario: contradicted 摘要出图
- **GIVEN** a node whose verifier verdict is `contradicted`
- **WHEN** verification is applied
- **THEN** the node keeps its summary text, `verification` is `contradicted`, the intermediate record holds the reason, and `gaps` contains `summary-contradicted`

#### Scenario: 运行方式可见
- **WHEN** verification ran with sampling of 50 summaries
- **THEN** `project.verification` equals `sample:50`

### Requirement: 引用完整性与领域步骤锚定

The validator SHALL keep all prior structural checks (required node fields, duplicate ids, dangling edge endpoints, layer and tour references) and SHALL require every `step` node to carry `nodeIds` that exist in the graph, or `provenance: "inferred"`; otherwise record gap `step-unanchored`.

The layer checks (a layer references only existing nodes, a node is in at most one layer, every file node is in a layer) read the layers of the graph. When the graph has no layers at all, they SHALL read the `layers` of `semantic-graph.json` in the same directory as the graph file, because Full writes the layers there and not into the fact graph. A `semantic-graph.json` that is missing, unreadable, or has no layers leaves the layers empty, so the file nodes are still reported as not in any layer: nothing passes because the layers could not be found.

#### Scenario: 无 nodeIds 的步骤被计数
- **GIVEN** a domain graph step with neither `nodeIds` nor `provenance: "inferred"`
- **WHEN** the validator runs
- **THEN** `gaps` contains `step-unanchored` naming the step

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
