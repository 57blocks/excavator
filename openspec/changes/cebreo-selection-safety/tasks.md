每组按仓库规则执行：coder 先写失败验收 → acceptor 冻结并证明 oracle 可见 → coder 实现 → acceptor 复测 → 单独 commit。合成夹具不含真实凭据；真实 cebreo 仅做 opt-in 选择层检查，源码、绝对路径和输出不提交。

## 1. 冻结选择安全 oracle

- [ ] 1.1 添加合成夹具与失败验收：唯一 canary 假私钥 + 同大小普通文本、`bin/rails` + MAUI 生成树、Git/Directory/MultiRepo 同内容、TypeScript 与 Dockerfile 正反例、zip 有/无对照；验证目标测试在当前 `main` 上只因本 change 的缺失而红。
- [ ] 1.2 由 acceptor 独立审查断言并做 verify-the-instrument：临时绕过敏感判断、适配器过滤和 no-source-loss 检查时，对应测试必须变红；恢复夹具后记录冻结的测试命令与预期失败点。
- [ ] 1.3 提交仅含红灯验收的 oracle commit；验证 `git show --stat HEAD` 不含项目实现文件改动。

## 2. 核心选择策略与安全桶

- [ ] 2.1 在 `packages/core` 实现版本化的纯选择策略与 tagged decision，分清 default、project ignore、sensitive 和 selected；验证路径规则、普通 `!LICENSE`、不可恢复的 `.excavator/`/archive/sensitive 单测全绿。
- [ ] 2.2 实现敏感扩展和有界私钥头检测；禁止内容、excerpt、content hash 进入结果或日志；验证 canary 全仓产物/输出搜索为空且普通文本控制样本仍 selected。
- [ ] 2.3 扩展 scan/coverage schema 与守恒计算，合并 selection ledger 后每个候选恰好一桶；验证含全部 exclusion/skip/extraction outcome 的合成守恒测试全绿。
- [ ] 2.4 提交核心选择策略 commit；验证 commit 只包含 core policy/schema/tests 与必要导出。

## 3. 语言识别统一到 LanguageRegistry

- [ ] 3.1 扩展 `LanguageConfig`/`LanguageRegistry` 的 basename pattern，并在 Dockerfile config 声明 `Dockerfile.*`、`Dockerfile-*`；验证 exact → pattern → extension precedence、TypeScript `.ts/.tsx` 和负例 `MyDockerfile-prod`。
- [ ] 3.2 让 `scan-project.mjs` 对已注册语言调用 canonical registry matcher，移除 TypeScript/Dockerfile 的权威重复判断；用当前分类矩阵证明除批准的 Dockerfile hyphen 变体外零漂移。
- [ ] 3.3 让 category 基于 canonical `dockerfile` 结果产出 `infra`，覆盖 `Dockerfile-prod|qa|test`；验证 scanner 与 `LanguageRegistry.createDefault()` 对同一路径给出相同 language。
- [ ] 3.4 提交语言注册统一 commit；验证未修改 `FrameworkConfig`/`FrameworkRegistry`，后续框架 change 仍沿 Express 的注册方式扩展。

## 4. SourceSnapshot 只暴露并物化 selected 输入

- [ ] 4.1 DirectorySnapshot 在 hash/revision/materialize/search 前应用共享策略并暴露 safe ledger；验证敏感变更不改 source revision、策略版本变化会改 `selectionDigest`、一致性 guard 仍通过。
- [ ] 4.2 GitCommitSnapshot 用固定 SHA 枚举并只写 selected 路径，删除“整树 archive 后 prune”路径；验证临时树从未出现 canary、HEAD-only 与 dirty-worktree 既有测试不回归。
- [ ] 4.3 MultiRepoSnapshot 组合 parent/member ledger 与有序 digest、路径前缀恰好一次；验证三 adapter 对同内容的 selected set/selection digest 一致。
- [ ] 4.4 Lazy/增量/direct scan 复用 snapshot ledger，scan、facts、source index、search 都无法恢复被拒路径；验证合成端到端的 canary 搜索与 coverage 守恒全绿。
- [ ] 4.5 提交 SourceSnapshot 接线 commit；验证 source-snapshot、revision-sync、lazy 测试全绿。

## 5. 收敛根目录 ignore 与 MAUI 项目配方

- [ ] 5.1 把 generator、core filter、snapshot、incremental 和 skill 统一到根 `.excavatorignore`，删除 `.excavator/.excavatorignore` 读取；旧位置存在时只给一次明确迁移提示、不回退读取；验证 Git HEAD 与 Directory 的规则一致。
- [ ] 5.2 增加确定性 ignore 配方校验器及 MAUI/cebreo 建议项 `bin/ .unit-test/ TestResults/ .vs/ .gradle/ .scratch/`，建议默认保持注释；验证对照报告 source loss 为 0，且非 MAUI `bin/rails` 仍 selected。
- [ ] 5.3 更新用户文档/skill 的生成路径、审阅步骤和 no-source-loss 命令；验证仓库中不再有“data-dir `.excavatorignore` 是规则源”的运行指令。
- [ ] 5.4 提交 ignore 收敛 commit；验证 `selectionDigest` 对 root rules、CLI rules、安全策略版本的任一变化都会变化。

## 6. 集成验收与独立 acceptor

- [ ] 6.1 跑完整合成端到端：三 adapter、direct scan、Lazy、增量、facts、source index/search；验证零 canary 泄漏、零遗漏桶、零非批准语言漂移、zip 有无 factsDigest 相同。
- [ ] 6.2 以 `CEBREO_ROOT` opt-in 运行选择层校验，不写真实源码/路径/输出：验证建议配方移除的 `.cs/.xaml/.csproj/.feature` 为 0、敏感候选仅计数、`unmc.zip` 是否仍存在都不影响结论；完整 cebreo 质量指标留给最后一个 ordered change。
- [ ] 6.3 由 acceptor 在干净 worktree 独立复跑冻结 oracle，审计 Git 临时树未落敏感文件、scanner 无 cebreo 特判、语言走 registry、framework 未越界；任何“编造/泄漏”失败为硬阻断，coverage 遗漏单列。
- [ ] 6.4 运行 `openspec validate --strict cebreo-selection-safety`、`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`；全部通过后提交 gate/记录 commit，并确认主 checkout 与其他活跃 change 未被修改。
