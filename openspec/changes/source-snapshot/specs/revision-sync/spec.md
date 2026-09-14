## Purpose

定义基于 revision 的增量同步：当源码基线变化时，只重建受影响的确定性产物，而不是每次全量重跑。复用既有 `prepare-incremental.mjs` 的 diff 与原子写能力，保证增量与全量得到同一份事实。

## ADDED Requirements

### Requirement: 新鲜度失配触发同步

当当前 `sourceRevision` / `selectionDigest` / `pipelineVersion` 与已持久化的 `source-manifest.json` 不一致时，系统 SHALL 触发增量同步；一致时 SHALL 不做重建。

#### Scenario: manifest 一致则跳过
- **WHEN** 三个键都与持久化 manifest 相同
- **THEN** 不重建、不推进 manifest

#### Scenario: revision 变化触发同步
- **WHEN** sourceRevision 变化
- **THEN** 进入增量同步流程

### Requirement: 变更集来自 diff，不猜

Git 项目 SHALL 用 commit diff 得到变更集；非 Git 目录 SHALL 用前后 manifest diff 得到新增/修改/删除。重命名即使 Git 未识别，SHALL 按删除+新增正确处理。系统 SHALL 复用既有 `prepare-incremental.mjs`（含 git-diff、非 git content-hash diff、删除检测、原子写），MUST NOT 手工构造变更集。

#### Scenario: 目录改名按删除+新增
- **WHEN** 非 Git 目录里一个文件被改名
- **THEN** 旧路径记为删除、新路径记为新增，节点身份不张冠李戴

### Requirement: 增量重建受影响事实

新增或修改的文件 SHALL 整文件重新抽取结构（MUST NOT 复用旧行号）；删除的文件 SHALL 移除其事实节点与边；SHALL 重新解析受影响的 imports/exports 与唯一可解 calls；SHALL 重算 coverage、gaps、fingerprints 与 factsDigest。

#### Scenario: 函数体变化后行号与调用更新
- **WHEN** 一个文件在前面插入代码行、并改变函数体内的调用
- **THEN** 该文件相关节点的行号与 calls 边被正确更新，未改文件的事实不受影响

### Requirement: 原子保存先于推进 manifest

系统 SHALL 在原子保存全部确定性产物成功之后才推进 `source-manifest.json`。保存失败时 MUST NOT 推进 sourceRevision / manifest / fingerprints / meta。

#### Scenario: 保存失败不推进 manifest
- **WHEN** 增量同步的原子保存失败
- **THEN** source-manifest 与相关元数据保持上一个成功状态

### Requirement: adapter 类型变化触发完整重建

当 SourceSnapshot 的 adapter 类型发生变化（例如普通目录之后被 `git init` 成 Git 仓库）时，系统 SHALL 执行完整确定性重建，并按新 manifest 重新判断所有下游新鲜度，MUST NOT 走增量。

#### Scenario: 目录被 git-init 后完整重建
- **WHEN** 上次是 DirectorySnapshot、本次同一目录已成为 Git 仓库
- **THEN** 执行完整确定性重建而非增量
