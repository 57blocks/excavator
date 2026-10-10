## MODIFIED Requirements

### Requirement: 结构事实带行号交给模型

The structural extraction handed to the model SHALL include, per file, functions and classes with `lineRange` and `owner`, imports and exports with line numbers, and call sites with line numbers; the analysis skill SHALL run structural extraction over all scanned files before batching so the same facts are available for auditing.

#### Scenario: 全量结构抽取可用
- **WHEN** an analysis run reaches the batching phase
- **THEN** `intermediate/structure-all.jsonl` exists and covers every file the scanner marked as code
