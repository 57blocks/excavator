# worktree-isolation Specification

## Purpose

让 worktree 内的 Excavator 使用该 worktree 自身的 `.excavator/`、图只对应该 worktree 的 SourceSnapshot revision，消除 Phase 0 把输出重定向到主 checkout 导致的跨分支互相覆盖同一图问题（计划 §10）。

## Requirements

### Requirement: worktree 使用自身的数据目录，不重定向

在 git worktree（而非主 checkout）中运行时，Excavator SHALL 把 `.excavator/` 写在该 worktree 内，MUST NOT 把输出重定向到主 checkout 的仓库根。此前用于强制 per-worktree 的 `EXCAVATOR_NO_WORKTREE_REDIRECT` 开关 SHALL 移除（默认即 per-worktree）。

#### Scenario: worktree 内分析写在 worktree 内

- **WHEN** `PROJECT_ROOT` 位于 git worktree（`git rev-parse --git-dir` 与 `--git-common-dir` 不一致）并运行分析
- **THEN** `.excavator/` 数据目录创建在该 worktree 内，主 checkout 的仓库根不被写入

### Requirement: worktree 图只对应该 worktree 的 revision

worktree 的知识图 SHALL 只对应该 worktree 解析出的 SourceSnapshot revision；不同 worktree（不同分支/HEAD）MUST NOT 共享同一份可写图或缓存而互相覆盖。

#### Scenario: 两个 worktree 不互相覆盖

- **WHEN** 同一仓库的两个 worktree 处于不同 HEAD 且各自运行分析
- **THEN** 两者各自的 `.excavator/` 图对应各自 worktree 的 SourceSnapshot revision，互不覆盖

### Requirement: worktree 缓存生命周期对用户可见

skill 散文 SHALL 明示「worktree 删除时其 `.excavator/` 缓存一起丢失」这一取舍（计划 §10 声明容忍），使行为对用户可见，MUST NOT 与其它文档默默矛盾。

#### Scenario: 删除 worktree 即容忍缓存丢失

- **WHEN** 用户删除一个 worktree
- **THEN** 该 worktree 内的 `.excavator/` 缓存随之丢失属预期行为（skill 文档已说明），不视为错误
