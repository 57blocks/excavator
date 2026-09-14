每组：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built 项目；真实语料（wcp 多仓、wcp-auth 单仓）opt-in、产物/路径不提交。CODE 与测试用英文，本 openspec 用中文。

## 1. SourceSnapshot 契约 + DirectorySnapshot + 一致性 guard

- [ ] 1.1 写契约与 DirectorySnapshot 验收（先红）：`resolveSourceSnapshot(dir)` 返回 DirectorySnapshot；`revision` 为 `directory:<sha256(排序 {path,contentHash})>`；`.excavator/` 排除且不计入 revision；新增/修改/删除文件 → 新 revision；`listFiles`/`readFile` 一致；一致性 guard：读时校验 hash、发布前重算 digest、不一致重试一次、仍变化保留旧并显式失败。验证：`tests/snapshot/` vitest 先红。
- [ ] 1.2 实现 `skills/excavator/source-snapshot.mjs`：契约 + `resolveSourceSnapshot` 工厂 + DirectorySnapshot（物化到 temp、排除 `.excavator/`、content-hash manifest、guard）。验证：1.1 全绿。
- [ ] 1.3 一致性 guard 的失败路径：注入「发布前 digest 变化」两次 → 保留旧图旧 revision、退出非零。验证：guard 失败用例绿（含 verify-the-instrument：先造一次已知不一致确认能红）。

## 2. GitCommitSnapshot（HEAD-only）

- [ ] 2.1 写验收（先红）：git 夹具 → `revision` 为 `git:<full-head-sha>`；清单/读取只反映 HEAD；加 staged/unstaged/untracked 后 revision 与 `listFiles`/`readFile` 不变；`.excavatorignore` 从 HEAD 读；终端提示含 `uncommitted changes ignored`。验证：先红。
- [ ] 2.2 实现 GitCommitSnapshot：`git ls-tree`/`git show HEAD:`/`git grep … HEAD`；物化用 `git archive HEAD` 展开到 temp。验证：2.1 全绿（含「工作区脏 → 结果不变」场景）。

## 3. MultiRepoSnapshot（成员 HEAD + 父目录）

- [ ] 3.1 写验收（先红）：父非 git + N 个成员 git 的夹具 → `revision` 为 `multi-repo:<sha256(排序 成员相对路径+成员 HEAD)>`；成员按 GitCommitSnapshot 读（成员工作区变化不进结果）；父目录非成员源码按 DirectorySnapshot 计入；父 ignore 进 selectionDigest；探测：父是 git 则走 GitCommitSnapshot 不进多仓。验证：先红。
- [ ] 3.2 实现 MultiRepoSnapshot：物化各成员 `git archive HEAD` 到 `temp/<memberId>/` + 父非成员文件拷入；revision/selectionDigest 从源算。验证：3.1 全绿（含「成员脏 → 结果不变」）。

## 4. source-manifest + 把 Lazy 驱动接到 SourceSnapshot

- [ ] 4.1 写验收（先红）：`lazy-analyze` 经 SourceSnapshot 取源（物化 → 既有脚本）并写 `source-manifest.json`（sourceRevision/selectionDigest/pipelineVersion）；不再依赖直接 `git rev-parse` 决定分析内容；`.excavator/` 排除由 selection 统一保证。验证：先红。
- [ ] 4.2 改 `skills/excavator/lazy-analyze.mjs`：`resolveSourceSnapshot(root)` → 物化 temp → 跑既有 scan/structure/import-map → build-fact-graph → 写 source-manifest + 图/meta/fingerprints；用后清理 temp。验证：4.1 全绿；切片 A 的 `tests/lazy` 全绿（无回归）。

## 5. revision 增量同步

- [ ] 5.1 写验收（先红）：manifest 一致 → 跳过不推进；`sourceRevision`/`selectionDigest`/`pipelineVersion` 任一变化 → 触发同步；git commit 增/删/改/重命名/revert、非 git 目录增/删/改 → 结果正确；改动文件行号与 calls 更新、未改文件事实不变；保存失败 → manifest 不推进；adapter 类型变化（目录后 git-init）→ 完整重建。验证：`tests/revision-sync/` 先红。
- [ ] 5.2 实现 `skills/excavator/sync-fact-graph.mjs`：复用 `prepare-incremental.mjs` 判定变化；有变化则对新快照重跑确定性投影（D4）；原子保存全部产物**后**才推进 source-manifest；adapter 变化走完整重建。验证：5.1 全绿。

## 6. 跨 adapter 身份 + 端到端 + 门禁

- [ ] 6.1 写验收（先红）：同一份合成源码内容分别以 Git 仓库与普通目录分析 → 事实节点/边一致且 `factsDigest` 相同（§12.4.1）。验证：先红→实现后绿。
- [ ] 6.2 合成端到端：三 adapter 首建 + 各自增量一轮，确定性、无 LLM、事实齐、缺失可见。验证：端到端套件绿。
- [ ] 6.3 opt-in 真实验证：wcp（多仓，MultiRepoSnapshot）首建 + 一次成员提交后的增量；wcp-auth（单仓，GitCommitSnapshot）首建 + 工作区脏不变；记录耗时与 revision（源码/产物不提交）。验证：产出记录，跨 adapter 一致性在真实语料成立。
- [ ] 6.4 门禁：`openspec validate --strict source-snapshot` 通过；`pnpm test` 与 typecheck 全绿；不删除/弱化既有测试；切片 A 套件无回归。
