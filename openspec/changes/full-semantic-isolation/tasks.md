每组：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built 项目；真语料（wcp）与真 provider 验收 opt-in、产物/路径不提交。CODE 与测试用英文，本 openspec 用中文。

## 1. Full 物理隔离：语义写独立产物，事实字段不可被改

- [x] 1.1 写验收（先红）：Full 生成语义后，`knowledge-graph.json` 的事实字段（节点身份/源码范围/结构边/coverage/gaps）逐字不变；summary/tags 出现在 `semantic-cache.json`、layers/架构出现在新增 `semantic-graph.json`；无法映射到事实节点的模型输出记 semantic gap，不建假锚点。验证：`tests/full/` 先红（含注入假 provider 的语义补丁）。
- [x] 1.2 新增 `semantic-graph.json` 产物与其写入模块：layers 的 nodeIds 经 `node-identity` 与事实图一致，overlay 不复制/改写事实节点边；顶层记 `factDigest`。改 `annotate-graph`/`publish-annotations`/`apply-verification` 的写入目标为独立语义产物，绝不触碰事实字段。验证：1.1 全绿（事实字段 SHA-256 前后不变）。

## 2. Full 复用事实构建 + 增量 + 架构 factDigest 门

- [x] 2.1 写验收（先红）：`--mode=full` 先跑 `scan → structure-all → build-fact-graph`，Full 与 Lazy 对同一源码 `factDigest` 一致；Full 只为语义缺失/过期（按 `semanticSourceHash`）的文件出批；`semantic-graph.json` 以 factDigest 为键，factDigest 未变则不重跑 Architecture、复用已有；Summary-Verifier 在 Full 核验语义、不进 Lazy。验证：先红。
- [x] 2.2 改 `skills/excavator/SKILL.md` full 分支：删「LLM 造结构图」，改为复用事实构建 + 语义生成阶段（file-analyzer 产节点局部语义补丁进 semantic-cache；architecture/assemble 产 layers 进 semantic-graph）；`compute-batches` 只出缺失/过期文件；架构走 factDigest 门；Summary-Verifier 核验语义产物。验证：2.1 全绿；lazy 路径无回归（切片 A 套件绿）。

## 3. Domain 新鲜度

- [x] 3.1 写验收（先红）：`annotate-domain` 在 `domain-graph.json` 顶层写 `sourceRevision` + `factDigest`；revision/factDigest 与当前事实层不一致的 Domain 不进回答；一致的 domain/flow/step 仅作提示且回源核对。验证：`tests/domain/` 先红。
- [x] 3.2 实现 Domain 新鲜度写入与消费端门控（读 Domain 前比对当前事实层）。验证：3.1 全绿（过期 Domain 被忽略 + 一致 Domain 回源核对）。

## 4. 消费端统一 sourceRevision

- [x] 4.1 写验收（先红）：共享新鲜度助手 `resolveFreshness(projectRoot)` → `fresh|stale|missing` + 差异，基于 `source-manifest.json` 的 `sourceRevision`；git 经 GitCommitSnapshot（工作区脏不影响判定与读源）、directory 经 DirectorySnapshot + content-hash guard（漂移先同步）。验证：`tests/consumer-freshness/` 先红（含 git 脏工作区、directory 漂移两场景，verify-the-instrument）。
- [x] 4.2 实现共享助手；把 `excavator-chat`/`-diff`/`-explain`/`-onboard`/`-domain` SKILL.md 与 `hooks/` 自动更新 hook 改用它、统一经 SourceSnapshot 读源，删除各自的 gitCommitHash/sourceDigest 判定。验证：4.1 全绿；`tests/refs`（skill/hook 引用完整性）绿；`tests/hooks` 绿。

## 5. 端到端 + 真语料 + 门禁

- [x] 5.1 合成端到端：一个小项目跑 full（注入假 provider）→ 事实字段不变、语义在独立产物、factDigest 门生效；再改一个文件跑 full → 只补该文件语义、架构按 factDigest 决定重跑与否。验证：端到端套件绿。
- [ ] 5.2 opt-in 真语料 + 真 provider（不提交）：wcp 上跑一次 full，证明 Full 与 Lazy 事实投影一致且 `knowledge-graph.json` 事实字段不被语义写入改动；抽查 Full 生成的 summary/layers 可靠、零编造、layers 合理。记录数字与样例。验证：真跑证据（fake 全绿不顶替）。
- [ ] 5.3 门禁：`openspec validate --strict full-semantic-isolation` 通过；`pnpm test` 与 typecheck 全绿；不删除/弱化既有测试；A/B/C 套件无回归；确认 Full 语义写入前后 `knowledge-graph.json` 事实字段 SHA-256 不变。
