## MODIFIED Requirements

### Requirement: 原子保存先于推进 manifest

系统 SHALL 在原子保存全部确定性产物成功之后才推进 `source-manifest.json`。原子保存 SHALL 先把本次的全部最终产物（`knowledge-graph.json`、source index、fingerprints、meta、manifest）完整写到数据目录内的暂存位置，全部写成功后才替换到最终位置，manifest 最后替换。保存失败时——无论失败发生在写暂存还是替换阶段——MUST NOT 推进 sourceRevision / manifest / fingerprints / meta，且 MUST NOT 改动任何最终产物；暂存内容 SHALL 被清理。

#### Scenario: 保存失败不推进 manifest
- **WHEN** 增量同步的原子保存失败
- **THEN** source-manifest 与相关元数据保持上一个成功状态

#### Scenario: 写到一半的保存失败不留半成品
- **WHEN** 部分产物已写入暂存位置后，另一个产物的写入失败
- **THEN** 最终位置的全部产物与保存前逐字节相同，暂存内容已被清理

#### Scenario: 替换阶段失败
- **WHEN** 替换到最终位置的过程中某一步失败
- **THEN** 已替换的产物被恢复为保存前的版本，最终位置的全部产物与保存前逐字节相同
