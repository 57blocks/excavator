## MODIFIED Requirements

### Requirement: 锚点与证据触源码核对

The validator SHALL read source files. For every `function`/`class` node it SHALL confirm that the node's `name` (anonymous classes: the class keyword) appears either within one line of `lineRange[0]`, or on the first line that follows the node's leading lines, or, for a declaration whose head wraps, on a later line of that head, else record gap `anchor-mismatch` and set the node's `verification` to `contradicted`. A leading line holds nothing but blank space, comments, and annotations, decorators or attributes, including those whose arguments span several lines. A line that holds anything else once those are read off its start is the start of the construct and not a leading line: a statement, an annotation followed by a declaration on the same line, a comment followed by code, an array row after a bracket. Which annotation and attribute syntaxes exist is decided by the extension of the file: `@` annotations and decorators in Java, Kotlin, Scala, Groovy, Swift, Dart, TypeScript, JavaScript and Python files; `[Name]` attributes in C# files; `#[...]` attributes in Rust and PHP files; `//` line comments and block comments in the C family files (Java, Kotlin, Scala, Groovy, Swift, Dart, TypeScript, JavaScript, C#, Rust, PHP, Go, C and C++); `#` comments in Python, Ruby, shell, Perl, R, Elixir and PHP files. A file of any other language has no annotation, attribute or comment syntax, and blank lines are the only leading line every language has. A line that starts with `*` or `//` in a Python or Ruby file is the continuation of an expression, and a line that starts with `*` is not read as the continuation of a block comment in any language. Skipping leading lines SHALL only move forward from `lineRange[0]` and SHALL stop at the first line that is none of those. A declaration head wraps when the first line after the leading lines starts with a declaration modifier (`public`, `private`, `protected`, `internal`, `final`, `abstract`, `sealed`, `open`, `override`, `virtual`, `synchronized`, `native`, `readonly` or `partial`), holds only words and types with no parenthesis, brace, semicolon or `=`, and holds no declaration keyword (`class`, `interface`, `enum`, `record`, `struct`, `delegate`, `event`, `namespace`, `operator`), because such a line already has its name; the head then runs over the following lines that hold only words and types, and a line that starts with a modifier or an annotation is a declaration of its own and is not part of it. The name is looked for up to the first line that has a parenthesis, brace, semicolon or `=`. A word that also starts a statement (`export`, `const`, `static`, `async`) never starts a head. Declaration heads wrap only in the languages whose declarations always end in a semicolon or a body, so that a line of modifiers and words is never a complete declaration, by file extension: Java and C# files.

For every `extracted` edge it SHALL confirm the evidence line contains the expected token (for `calls`, the `token` the evidence entry carries when it has one — a JSX element writes the tag name, which an import may have renamed — else the callee name; target module or specifier for `imports`, symbol name for `exports`, the declaration for `contains`; for model-cited evidence, the name or file of either endpoint), else set the edge's `verification` to `contradicted` and record gap `edge-contradicted`. An edge written by an extractor whose evidence entry does not name the token its line holds, and which is not a `calls` edge, is also confirmed when the cited line is the first line of the range of an endpoint whose name is the expected token and whose own anchor is confirmed exactly: the name is on `lineRange[0]` itself or on the first line after its leading lines, not only within one line of it. This is decided from the graph, not from how the cited line reads, so a cited line that is any other line is not confirmed by it. An edge written by an extractor that is a `calls` edge, whose evidence entry does not name the token its line holds, is confirmed when the callee name is anywhere in the call expression that starts on the cited line, in a file of a language with a brace-and-statement grammar, by file extension: Java, Kotlin, Scala, Groovy, Swift, Dart, TypeScript, JavaScript, C#, Rust, PHP, Go, C and C++ files. The expression ends at the first top-level `;`, at a block body that opens at the top level (a function or a branch is not part of the expression), or at the first line that neither ends in a continuation nor is followed by one. A continuation is a trailing `.`, `\`, `=`, `&&`, `||`, `->`, `=>` or a single `+`, and a following line that starts with `.`, `?.`, `&&`, `||`, `+`, `?`, `->`, `=>` or `|`; a line ending in `,`, `++`, `--`, `*`, a nullable type's `?` or a closing comment is not one. The scan reads a string, a character and a comment as the language writes them, and stops, so that the edge is checked against the cited line alone, at a line that ends inside a string or a block comment (a text block, a template literal, a raw string, a verbatim string), or opens a PHP heredoc: what the next lines hold cannot be told from code. A Rust apostrophe is a character literal or a lifetime, not the start of a string. A `calls` edge in a file of any other language is checked against the cited line alone. Evidence cited by the model SHALL still be checked against the cited line alone.

When the leading lines of an anchor, the head of a declaration, or the call expression of a `calls` edge are longer than the validator's scan bound, the node or edge SHALL be set to `verification: "unverified"` and counted under gap `construct-too-long`; it SHALL be neither confirmed nor contradicted.

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

#### Scenario: 修饰符折行的声明被确认
- **GIVEN** a Java method whose modifiers and return type are on one line (`public void`, or `private void` with an annotation above it) and whose name is on the next, and `contains` and `exports` edges citing its first line
- **WHEN** the validator runs
- **THEN** its anchor and those edges are confirmed; a statement-shaped line in the head's place (`import os`, `return x`, `export default router`, `static x`) is not the start of a head, and a head that is already complete (it holds a parenthesis or a brace) is not read past

#### Scenario: 折行声明头只在声明总以分号或体结束的语言里
- **GIVEN** the text `public` followed by a line that holds a name, in a Python, Ruby, Go, Kotlin, Scala, Swift, Dart, TypeScript, PHP or unrecognised file
- **WHEN** the validator runs
- **THEN** it is not read as a wrapped declaration head

#### Scenario: 已经写完的声明行不是没写完的头
- **GIVEN** a Java or C# line that holds a modifier and a declaration keyword (`private class Marker`, `public sealed class Shape`, `internal struct Pair`), or a modifier line followed by a line that starts with a modifier or an annotation (`public Foo` and then `public void helper() {}`), with a node `helper` whose range starts on the first line, and a `contains` edge that cites it
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`, because the first line is a declaration of its own and the next line is another member; a head whose second line starts with the return type (`public static` and then `void bare() {}`) is still read

#### Scenario: 链式调用跨多行被确认
- **GIVEN** an extractor-written `calls` edge in a Java file whose evidence line holds the receiver and whose callee name is on the third line of the same chained expression, written with leading dots, a second one written with trailing dots in a Go file, a ten-line builder chain, and a callee that follows a lambda block in the middle of a chain
- **WHEN** the validator runs
- **THEN** every one of those edges is confirmed; with the callee name absent from the expression, or present only in the next statement, it is `edge-contradicted`

#### Scenario: 块体不并入表达式
- **GIVEN** an extractor-written `calls` edge whose evidence line opens the body of a function or a branch, with the callee named only inside that body
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`; a callee named on the same line as the opening brace is confirmed

#### Scenario: 续行判据偏向少认
- **GIVEN** a line ending in `,`, `++`, `--`, `*`, a nullable type's `?` or a closing comment, followed by a line that names the callee
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`

#### Scenario: 字符串或注释读不到头就停下
- **GIVEN** an extractor-written `calls` edge whose cited line opens a call and ends inside a Java text block, a TypeScript or Go template or raw string, a C++ raw string, a C# verbatim string, a Kotlin or Rust raw string, a PHP heredoc or an unterminated block comment, with the callee named on a later line
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`; a string or a comment that closes on its own line is read as code, a Rust character literal that holds a bracket (`'('`) does not keep the semicolon after it from ending the expression, and a Rust lifetime (`'a`) is not the start of a string

#### Scenario: 注解参数里读不到头的字符串或注释不是前导语法
- **GIVEN** an annotation whose argument opens a text block, or a block comment it does not close, and a node whose range starts at that annotation
- **WHEN** the validator runs
- **THEN** the line is the start of the construct and not a leading line, so a name further down does not make the anchor exact

#### Scenario: 表达式扫描只在有这种语法的语言里
- **GIVEN** a `calls` edge in a Python or Ruby file whose callee name is on the line after the cited line
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`, as it is on the cited line alone

#### Scenario: 模型引用的证据不享受表达式扫描
- **GIVEN** a model-cited `calls` edge whose callee name is on the line after the cited line
- **WHEN** the validator runs
- **THEN** the edge is `edge-contradicted`

#### Scenario: 过长的表达式可见而不下结论
- **GIVEN** an extractor-written `calls` edge whose expression runs past the scan bound without a terminator and without the callee name
- **WHEN** the validator runs
- **THEN** the edge has `verification: "unverified"`, gap `construct-too-long` counts it, and `edge-contradicted` does not
