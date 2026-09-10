## Purpose

图的「对应提交」只随重新推导前进：内容变了而结构签名没变的文件让其节点变 dirty，不盖新的 commit 章；没有 git 的目标用源码 digest 作对应版本。

## ADDED Requirements

### Requirement: commit 标记只随重推导前进

When an incremental run classifies all changes as cosmetic (content hash changed, structural fingerprint unchanged) and therefore skips re-analysis, it SHALL NOT advance `project.gitCommitHash` nor the metadata commit marker; it SHALL record the baseline commit and the list of dirty files, and SHALL mark the affected `file` nodes and their contained nodes with `verification: "dirty"`. When re-analysis runs (partial, architecture, or full), the marker SHALL advance.

#### Scenario: cosmetic 变更不前进
- **GIVEN** a graph at commit A and a new commit B that only changes a threshold literal inside one function body
- **WHEN** the incremental run executes
- **THEN** the commit marker still says A, the changed file's nodes carry `verification: "dirty"`, and the baseline record lists that file

#### Scenario: 结构变更前进
- **GIVEN** commit B changes a function signature
- **WHEN** the incremental run executes
- **THEN** re-analysis runs for that file and the commit marker advances to B

### Requirement: 无 git 目标用源码 digest

For a project without a git repository, freshness SHALL be `unknown` with reason `no-git`, `project.gitCommitHash` SHALL be `null`, and `project.sourceDigest` SHALL identify the analysed sources.

#### Scenario: 非 git 目标
- **WHEN** a non-git project is analysed twice with identical content
- **THEN** both runs report the same `sourceDigest` and freshness `unknown/no-git`

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
