每组按仓库规则执行：先用 design D0 说明为什么不能由 skill/prompt 完成；不能通过 D0 的工作只改 skill/prompt，不进产品代码。coder 先写失败验收 → acceptor 冻结并证明 oracle 可见 → coder 实现 → acceptor 复测 → 单独 commit。合成夹具不含真实凭据；真实 cebreo 仅做 opt-in 选择层检查，源码、绝对路径和输出不提交。

## 1. 冻结选择安全 oracle

- [x] 1.1 写 D0 范围矩阵并添加合成失败验收：唯一 canary 假私钥 + 同大小普通文本、`bin/rails`、Git/Directory/MultiRepo 同内容、TypeScript 与 Dockerfile 正反例、zip 有/无对照；验证每项产品代码都有安全/确定性/持久化理由，测试在当前 `main` 上只因本 change 的缺失而红。
- [x] 1.2 由 acceptor 独立审查范围与断言并做 verify-the-instrument：临时绕过敏感判断或适配器过滤、或把 `bin/` 加入全局默认时，对应测试必须变红；MAUI/cebreo 规则发现不得出现新的产品测试模块或 runtime config。
- [x] 1.3 提交仅含红灯验收的 oracle commit；验证 `git show --stat HEAD` 不含项目实现文件改动。

## 2. 核心选择策略与安全桶

- [x] 2.1 在 `packages/core` 实现版本化的纯选择策略与 tagged decision，分清 default、project ignore、sensitive 和 selected；验证路径规则、普通 `!LICENSE`、不可恢复的 `.excavator/`/archive/sensitive 单测全绿。
- [x] 2.2 实现敏感扩展和有界私钥头检测；禁止内容、excerpt、content hash 进入结果或日志；验证 canary 全仓产物/输出搜索为空且普通文本控制样本仍 selected。
- [x] 2.3 扩展 scan/coverage schema 与守恒计算，合并 selection ledger 后每个候选恰好一桶；验证含全部 exclusion/skip/extraction outcome 的合成守恒测试全绿。
- [x] 2.4 提交核心选择策略 commit；验证 commit 只包含 core policy/schema/tests 与必要导出。

## 3. TypeScript/Dockerfile 识别统一到 LanguageRegistry

- [x] 3.1 扩展 `LanguageConfig`/`LanguageRegistry` 的 basename pattern，并在 Dockerfile config 声明 `Dockerfile.*`、`Dockerfile-*`；验证 exact → pattern → extension precedence、TypeScript `.ts/.tsx` 和负例 `MyDockerfile-prod`。
- [x] 3.2 让 `scan-project.mjs` 对 TypeScript/Dockerfile 调用 canonical registry matcher，移除这两类的权威重复判断；冻结既有 `jsonc`、env/dot-env、`svg`、`mk`、OpenAPI、docker-compose、`rst`、`txt/text` 兼容输出为显式后续债务，并用当前分类矩阵证明除批准的 Dockerfile hyphen 变体外零漂移。
- [x] 3.3 让 category 基于 canonical `dockerfile` 结果产出 `infra`，覆盖 `Dockerfile-prod|qa|test`；验证 scanner 与 `LanguageRegistry.createDefault()` 对同一路径给出相同 language。
- [x] 3.4 提交语言注册统一 commit；验证未修改 `FrameworkConfig`/`FrameworkRegistry`，后续框架 change 仍沿 Express 的注册方式扩展。

## 4. SourceSnapshot 只暴露并物化 selected 输入

- [x] 4.1 DirectorySnapshot 在 hash/revision/materialize/search 前应用共享策略并暴露 safe ledger；验证敏感变更不改 source revision、策略版本变化会改 `selectionDigest`、一致性 guard 仍通过。
- [x] 4.2 GitCommitSnapshot 用固定 SHA 枚举并只写 selected 路径，删除“整树 archive 后 prune”路径；验证临时树从未出现 canary、HEAD-only 与 dirty-worktree 既有测试不回归。
- [x] 4.3 MultiRepoSnapshot 组合 parent/member ledger 与有序 digest、路径前缀恰好一次；验证三 adapter 对同内容的 selected set/selection digest 一致。
- [x] 4.4 Lazy/增量/direct scan 复用 snapshot ledger，scan、facts、source index、search 都无法恢复被拒路径；验证合成端到端的 canary 搜索与 coverage 守恒全绿。
- [x] 4.5 提交 SourceSnapshot 接线 commit；验证 source-snapshot、revision-sync、lazy 测试全绿。

## 5. 收敛根目录 ignore 与 MAUI 项目配方

- [ ] 5.1 把 core filter、snapshot 和 incremental 统一到根 `.excavatorignore`，删除 `.excavator/.excavatorignore` 读取且不加 runtime 迁移分支；验证 Git HEAD 与 Directory 的规则一致。
- [ ] 5.2 更新 Excavator skill：检查旧/新路径、由 agent 检查项目和 `.gitignore`、直接写根 `.excavatorignore`、调用现有 scanner 做前后两次扫描；移除 skill 对 data-dir generator 的依赖，若生成器/helper 无其他生产消费者则删除其脚本、导出与测试。验证 `rg` 无旧调用或旧规则源说明。
- [ ] 5.3 在 skill 验收中让 agent 从两个现有 scan manifest 审阅 `bin/ .unit-test/ TestResults/ .vs/ .gradle/ .scratch/` 的 dropped paths，只有 source loss 为 0 才写规则；不得新增专用 validator、MAUI/cebreo registry 或 generated-directory classifier，且非 MAUI `bin/rails` 仍 selected。
- [ ] 5.4 提交 ignore 收敛 commit；验证 `selectionDigest` 对 root rules、CLI rules、安全策略版本的任一变化都会变化。

## 6. 集成验收与独立 acceptor

- [ ] 6.1 跑完整合成端到端：三 adapter、direct scan、Lazy、增量、facts、source index/search；验证零 canary 泄漏、零遗漏桶、零非批准语言漂移、zip 有无 factsDigest 相同。
- [ ] 6.2 以 `CEBREO_ROOT` opt-in 运行 skill 选择层校验，不写真实源码/路径/输出：agent 基于现有扫描证据确认建议配方移除的 `.cs/.xaml/.csproj/.feature` 为 0、敏感候选仅计数、`unmc.zip` 是否仍存在都不影响结论；完整 cebreo 质量指标留给最后一个 ordered change。
- [ ] 6.3 由 acceptor 在干净 worktree 独立复跑冻结 oracle，审计 Git 临时树未落敏感文件、scanner 无 cebreo 特判、TypeScript/Dockerfile 走 registry 且既有分类债务零漂移、framework 未越界，并逐个产品改动复核 D0；任何“编造/泄漏”失败或 AI 可做却落代码的模块为硬阻断，coverage 遗漏单列。
- [ ] 6.4 运行 `openspec validate --strict cebreo-selection-safety`、`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`；全部通过后提交 gate/记录 commit，并确认主 checkout 与其他活跃 change 未被修改。
