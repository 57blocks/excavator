## Purpose

图的「对应提交」只随重新推导前进：内容变了而结构签名没变的文件让其节点变 dirty，不盖新的 commit 章；没有 git 的目标用源码 digest 作对应版本。

## ADDED Requirements

### Requirement: cosmetic 变更可见

When an incremental run classifies changes as cosmetic (content hash changed, structural fingerprint unchanged) and skips re-analysis, the supplement SHALL record the affected files under `meta.json.excavator.dirtyFiles` and mark the affected `file` nodes and their contained nodes with `verification: "dirty"`. The existing commit-marker behaviour of the pipeline SHALL NOT be changed by this step.

#### Scenario: cosmetic 变更被标出
- **GIVEN** a graph at commit A and a new commit B that only changes a threshold literal inside one function body
- **WHEN** the incremental run executes
- **THEN** the changed file's nodes carry `verification: "dirty"`, `dirtyFiles` lists that file, and the pipeline's own commit marker behaves exactly as before this change

### Requirement: 无 git 目标用源码 digest

For a project without a git repository, freshness SHALL be `unknown` with the pipeline's existing reason for an unusable graph commit (`missing-graph-commit`), and `project.sourceDigest` SHALL identify the analysed sources. The reason strings of the freshness evaluator belong to the pipeline and SHALL NOT be renamed by this change. `project.gitCommitHash` SHALL be `null` for a single non-git directory; for a multi-repo parent whose members are separate repositories it SHALL keep the pipeline's own `multi-repo:<digest>` marker, which identifies the member states and is therefore version information, not an absence.

#### Scenario: 非 git 目标
- **WHEN** a non-git project is analysed twice with identical content
- **THEN** both runs report the same `sourceDigest` and freshness `unknown` with reason `missing-graph-commit`

#### Scenario: 多仓父目录保留自己的版本标记
- **GIVEN** a parent directory that is not itself a repository and whose `project.gitCommitHash` is `multi-repo:<digest>`
- **WHEN** the graph is annotated
- **THEN** `gitCommitHash` still equals that marker and is not replaced with `null`

#### Scenario: 不带标识符的值归一为 null
- **GIVEN** a `project.gitCommitHash` of `""`, `"unknown"`, `"HEAD"` or a missing field
- **WHEN** the graph is annotated
- **THEN** `gitCommitHash` is `null`, the replacement is counted, and the replaced value appears in the gap's samples

#### Scenario: 非 git 目标仍可增量
- **GIVEN** a non-git project (or a multi-repo parent directory that is not itself a repository) with an existing graph and fingerprints
- **WHEN** one file changes and the incremental preparation runs
- **THEN** it does not fail for lack of git, and the change set contains exactly that file

### Requirement: 四态保留

Freshness evaluation SHALL continue to report exactly one of `fresh`, `dirty`, `stale`, `unknown` with its reason.

#### Scenario: 未提交改动为 dirty
- **GIVEN** no commits since the graph's commit and one uncommitted modified file
- **WHEN** freshness is evaluated
- **THEN** the state is `dirty`
