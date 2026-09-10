## Purpose

零模型的事实图：对全部扫描文件普查声明，按 owner 限定身份，产出带行号证据的结构边（contains / imports / exports / calls），不能唯一连上的调用记为可见缺口；同一输入两次运行产物逐字节相同。

## ADDED Requirements

### Requirement: 普查全部声明为节点

The facts graph builder SHALL create one `file` (or `config`/`document` by file category) node per scanned file and one `function`/`class` node per declaration reported by the structural extractors, without significance filtering. The number of `function` + `class` nodes SHALL equal the number of declarations reported by the extractors for the same input.

#### Scenario: 声明数守恒
- **GIVEN** a fixture whose extractors report N functions and M classes
- **WHEN** the facts graph is built
- **THEN** it contains exactly N `function` nodes and M `class` nodes

### Requirement: 身份由路径、owner 与名字决定，冲突时加行号

Node ids SHALL be `<kind>:<path>:<owner>.<name>` when the declaration has an owner (receiver, enclosing class, trait, enum, object, or object-literal binding) and `<kind>:<path>:<name>` otherwise. When two or more declarations in the same file produce the same id, every member of that group SHALL have `@<startLine>` appended. Two files with identical content at different paths SHALL produce distinct nodes.

#### Scenario: 同名不同接收者不坍缩
- **GIVEN** a Go file with `func (a *A) Save()` and `func (b *B) Save()`
- **WHEN** the facts graph is built
- **THEN** it contains `function:<path>:A.Save` and `function:<path>:B.Save`

#### Scenario: 重载组加行号
- **GIVEN** a class with two methods named `Get` at lines 10 and 20
- **WHEN** the facts graph is built
- **THEN** it contains `…:Cls.Get@10` and `…:Cls.Get@20` and no `…:Cls.Get`

#### Scenario: 同内容不同路径
- **GIVEN** two files `a/util.ts` and `b/util.ts` with identical content declaring `f`
- **WHEN** the facts graph is built
- **THEN** it contains `function:a/util.ts:f` and `function:b/util.ts:f`

#### Scenario: 对象字面量方法与匿名类可寻址
- **GIVEN** a TS file `const api = { list() {}, get: () => {} }` and a PHP file with a trait method and an anonymous class method
- **WHEN** the facts graph is built
- **THEN** nodes `…:api.list`, `…:api.get`, `…:<Trait>.<method>` and `…:anon@<line>.<method>` exist

### Requirement: 结构边带行号证据

Every `contains`, `imports`, `exports`, `calls` edge in the facts graph SHALL have `provenance: "extracted"` and at least one evidence entry with `source` ∈ {`tree-sitter`, `import-map`} whose `line` is the declaration, import statement, export statement, or call site respectively.

#### Scenario: import 边证据行是 import 语句
- **GIVEN** `a.ts` importing `./b` at line 3
- **WHEN** the facts graph is built
- **THEN** the edge `file:a.ts → file:b.ts` of type `imports` has evidence `{file: "a.ts", line: 3, source: "import-map"}`

### Requirement: calls 只在唯一解析时成边

A call site SHALL become a `calls` edge only when the callee name resolves to exactly one declaration among the caller's file and the files it imports. Zero candidates SHALL be counted under gap `calls-unresolved`; more than one under `calls-ambiguous`; both per language with samples.

#### Scenario: 唯一解析成边
- **GIVEN** `a.ts` calls `helper()` at line 9 and `helper` is declared only in imported `b.ts`
- **WHEN** the facts graph is built
- **THEN** a `calls` edge from the caller node to `function:b.ts:helper` exists with evidence line 9

#### Scenario: 多义进缺口
- **GIVEN** `helper` is declared in two imported files
- **WHEN** the facts graph is built
- **THEN** no `calls` edge is created and `gaps` contains `calls-ambiguous` with count 1 for that language

### Requirement: 确定性

Running the builder twice on the same inputs SHALL produce byte-identical output and equal `project.factsDigest`.

#### Scenario: 两次运行相同
- **WHEN** the builder runs twice on a fixture
- **THEN** the two output files have equal sha256
