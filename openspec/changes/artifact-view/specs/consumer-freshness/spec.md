## MODIFIED Requirements

### Requirement: 消费端按 sourceRevision 判新鲜度

chat、diff、explain、onboard、domain、view skill 与自动更新 hook SHALL 用 `source-manifest.json` 的 `sourceRevision` 判断图谱/语义是否新鲜，MUST NOT 各自用临时的 gitCommitHash/sourceDigest 判定。

#### Scenario: 消费端统一用 sourceRevision
- **WHEN** 任一列出的消费端在使用图谱前检查新鲜度
- **THEN** 它比较当前 SourceSnapshot 的 `sourceRevision` 与持久化 manifest 的 `sourceRevision`，而不是自算一套 commit/digest

#### Scenario: view skill 烘焙前判定
- **WHEN** `/excavator-view` 在烘焙前检查新鲜度
- **THEN** 它调用共享助手比较当前 `sourceRevision` 与 manifest，把 fresh / stale / missing 写进页面并在终端提示，stale 时不阻止烘焙
