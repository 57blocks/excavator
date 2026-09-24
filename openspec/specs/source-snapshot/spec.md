# source-snapshot Specification

## Purpose

定义 SourceSnapshot——分析、检索与源码取证共用的单一取源抽象及其三种 adapter、统一的 `source-manifest.json`、以及非 Git 目录的一致性 guard。它让「当前分析的是哪一份源码」由一个稳定 revision 决定，不再各自直接读 git 或工作区，是新鲜度与跨 adapter 一致性的基座。

## Requirements

### Requirement: SourceSnapshot 契约

系统 SHALL 提供 SourceSnapshot 抽象，暴露 `revision`、`listFiles()`、`readFile(path)`、`search(terms)`、`diff(previousManifest)`。分析流水线（Lazy 驱动与扫描）SHALL 只经 SourceSnapshot 取源，MUST NOT 直接 `git rev-parse HEAD` 或直接读工作目录来决定分析内容。`revision` SHALL 是该源码版本的唯一基线。

#### Scenario: 流水线经 SourceSnapshot 取源
- **WHEN** Lazy 分析运行
- **THEN** 它通过 SourceSnapshot 的 `listFiles`/`readFile` 取源、以 `revision` 记录版本，而不是直接读 git/工作区

### Requirement: GitCommitSnapshot 只反映 HEAD

对 Git 项目，SourceSnapshot 的 `revision` SHALL 为 `git:<full-head-sha>`：文件清单来自 `git ls-tree`，读取用 `git show HEAD:<path>`，搜索用 `git grep … HEAD`，`.excavatorignore` 从 HEAD 读。staged / unstaged / untracked 内容 SHALL 全部忽略。只要 HEAD 不变，工作区变化 MUST NOT 改变图谱、索引或回答引用的源码。终端 SHALL 显示 `Analyzing git:<short-sha>; uncommitted changes ignored`。

#### Scenario: 工作区脏但 HEAD 不变
- **WHEN** 在同一 HEAD 下加入 staged/unstaged/untracked 变化后再次分析
- **THEN** revision、事实图与源码引用不变，且终端提示未提交改动被忽略

### Requirement: MultiRepoSnapshot 由成员 HEAD 决定

当根目录本身不是 Git 仓库但包含多个成员仓时，`revision` SHALL 为 `multi-repo:<sha256(排序后的 成员路径+成员 HEAD，以及父目录非成员源码的 directory digest)>`——即成员 HEAD 与父目录非成员内容**共同**决定 revision。父目录非成员源码内容变化 SHALL 改变 revision（否则父目录改动不会触发新鲜度失配、被漏同步）。每个成员仓 SHALL 按 GitCommitSnapshot 读取（忽略其工作区变化）；父目录中不属于任何成员仓的源码 SHALL 按 DirectorySnapshot 读取并计入该 digest；父目录生效的 ignore 规则 SHALL 进入 `selectionDigest`。系统 MUST NOT 把多仓父目录误当普通目录而去读成员仓工作区。

#### Scenario: 成员工作区变化不进结果
- **WHEN** 某成员仓有未提交改动
- **THEN** multi-repo revision 与结果不变（成员只由其 HEAD 决定，忽略工作区）

#### Scenario: 父目录非成员文件变化改变 revision
- **WHEN** 父目录里一个不属于任何成员仓的源码文件被修改
- **THEN** multi-repo revision 改变，从而触发新鲜度失配与重新同步

### Requirement: DirectorySnapshot 以磁盘内容为准

对普通非 Git 目录，`revision` SHALL 为 `directory:<manifest-digest>`，即对按路径排序的 `{path, contentHash}` 清单算 SHA-256。新增/修改/删除文件 SHALL 形成新 revision。`.excavator/` SHALL 始终排除；系统 MUST NOT 执行 `git init` 或自动创建提交。用户手动初始化 Git 后，下一次运行 SHALL 自动改用 GitCommitSnapshot。

#### Scenario: 目录内容变化产生新 revision
- **WHEN** 目录里新增或修改一个源码文件
- **THEN** directory revision 改变；`.excavator/` 内的产物不计入 revision

### Requirement: source-manifest 记录并驱动重建

系统 SHALL 持久化 `source-manifest.json`，至少含 `sourceRevision`、`selectionDigest`（生效的 ignore/exclude 规则）与 `pipelineVersion`。这三者任一变化 SHALL 触发重建受影响的确定性产物。

#### Scenario: selection 规则变化触发重建
- **WHEN** ignore/exclude 规则改变导致 `selectionDigest` 变化，即使 sourceRevision 不变
- **THEN** 受影响的确定性产物被重建

### Requirement: DirectorySnapshot 一致性 guard

对 DirectorySnapshot，发布前 SHALL 执行 revision guard：建立 manifest 并让每次 `readFile` 校验预期 content hash；所有产物先写临时文件；发布前重算 manifest digest；不一致时丢弃临时结果并重试一次；第二次仍变化则停止、保留旧图与旧 revision，并**显式失败**（MUST NOT 用旧图配新源码发布或假装成功）。

#### Scenario: 扫描期间目录持续变化
- **WHEN** DirectorySnapshot 分析期间源码持续变化，两次发布前校验都不一致
- **THEN** 保留旧图与旧 revision 并显式报失败，而不是发布不一致的产物

### Requirement: 跨 adapter 事实一致

相同源码内容经 GitCommitSnapshot 与 DirectorySnapshot 分析，SHALL 得到相同的确定性事实投影与相同的 `factsDigest`（`factsDigest` 已排除 sourceRevision/时间戳等运行元数据）。多仓成员前缀路径规则 SHALL 由 SourceSnapshot 统一提供给身份规范化。

#### Scenario: 同内容不同 adapter 同 factsDigest
- **WHEN** 同一份源码内容分别以 Git 仓库和普通目录形式被分析
- **THEN** 两者的事实节点/边一致，且 `factsDigest` 相同

### Requirement: git 快照批量读取

GitCommitSnapshot 在解析（读取文件头以做选择判定）、复制、计算内容哈希与全文检索时，SHALL 分批读取已提交的 blob，所用子进程数只随批次数增长，MUST NOT 随跟踪文件数逐个增长。批量读取的结果 SHALL 与逐文件读取同一提交的 blob 逐字节一致：revision、selectionDigest、选择台账、处理跳过记录、每个文件的内容哈希、复制出的文件内容，以及检索结果的内容与顺序都不变。读取文件头时 SHALL 只保留每个 blob 的前若干字节（与现有私钥头检测所需字节数相同），其余字节在读取过程中丢弃，MUST NOT 为了检查文件头而把整个 blob 读进调用方；未被选中的路径，其内容 MUST NOT 在复制、哈希或检索时向 git 请求。

#### Scenario: 批量读取与逐文件读取一致
- **WHEN** 对同一个提交分别用批量读取与逐文件读取完成解析、复制、哈希与检索
- **THEN** 两者得到的 revision、selectionDigest、选择台账、处理跳过记录、内容哈希、复制出的文件与检索结果逐字节相同

#### Scenario: 读文件头只保留前缀
- **WHEN** 一个跟踪文件远大于文件头检测所需字节数，并且在该字节数之后含有私钥等敏感内容
- **THEN** 解析阶段交给选择判定的只有前缀字节，调用方从不持有该文件其余部分

#### Scenario: 未选中路径不被请求
- **WHEN** 一个文件因敏感、默认规则或项目规则被排除
- **THEN** 复制、哈希与检索都不向 git 请求它的内容，复制目录中也不存在它

#### Scenario: 大仓库解析在秒级完成
- **WHEN** 在约 1.6 万个跟踪文件的 git 仓库上解析一次快照
- **THEN** 解析在数秒内完成，而不是随文件数增长到分钟级（观测目标，非正确性门槛）
