## Purpose

把所有消费端（问答与各分析 skill、自动更新 hook）的新鲜度判定统一到切片 B 的 `sourceRevision`，并统一经 SourceSnapshot 读源，消除各自为政的 gitCommitHash/sourceDigest 判定与工作区泄漏。

## ADDED Requirements

### Requirement: 消费端按 sourceRevision 判新鲜度

chat、diff、explain、onboard、domain skill 与自动更新 hook SHALL 用 `source-manifest.json` 的 `sourceRevision` 判断图谱/语义是否新鲜，MUST NOT 各自用临时的 gitCommitHash/sourceDigest 判定。

#### Scenario: 消费端统一用 sourceRevision
- **WHEN** 任一列出的消费端在使用图谱前检查新鲜度
- **THEN** 它比较当前 SourceSnapshot 的 `sourceRevision` 与持久化 manifest 的 `sourceRevision`，而不是自算一套 commit/digest

### Requirement: Git 消费端不泄漏工作区

Git 项目的消费端 SHALL 经 GitCommitSnapshot 读源（只反映 HEAD）；staged/unstaged/untracked 变化 MUST NOT 改变消费端引用的源码或使其误判新鲜度。

#### Scenario: 工作区脏不影响 git 消费端
- **WHEN** git 项目工作区有未提交改动但 HEAD 不变
- **THEN** 消费端读到的源码与新鲜度判定不受影响（仅按需一行提示未提交改动被忽略）

### Requirement: Directory 消费端带 content-hash guard

普通目录项目的消费端 SHALL 经 DirectorySnapshot 读源，并执行 content-hash guard：读文件时校验其 content hash，与 manifest 不一致时先同步新快照，MUST NOT 用旧图配新源码作答。

#### Scenario: 目录内容漂移触发同步而非错配
- **WHEN** 非 git 目录消费端读到的文件 content hash 与 manifest 不一致
- **THEN** 先同步到新快照再作答，而不是用旧图谱配已变的源码
