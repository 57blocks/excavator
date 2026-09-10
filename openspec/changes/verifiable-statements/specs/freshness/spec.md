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
