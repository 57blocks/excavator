# Excavator v2 — agent guide

Excavator v2 是在 Understand Anything（上游提交 5feed1f2，MIT，详见 NOTICE 里的原始仓库地址）基础上重建的 AI-first 可辩护代码调查插件。事实由确定性脚本写，散文由宿主 agent 写；每条陈述要么带证据，要么标 inferred。计划以 `openspec/changes/` 下的活跃变更为准；每个开发步是一个 OpenSpec change 加一个 PR。

## 执行纪律
- 无人守：判断题自己拍板并写下理由；不问用户。
- 一 coder 一 acceptor；编码/机械活 Sonnet，判断/审计/验收 Opus；验收 oracle 在动手前写死。
- 分阶段 commit：一个逻辑步一个 commit；PR 用 merge commit 合并，保留每个 commit 以便按步 revert。
- 先验装置再用装置：任何验证器/评分器先用已知假样本证明它看得见。
- 没有第四态：每个输入落一个可见桶；某语言/种类零记录必须出现在 coverage/gaps 里。
- 身份夹具：同内容不同路径、同名不同 owner。
- 零编造是硬指标，覆盖是软指标；汇报时「编造 vs 遗漏」分开算。
- 零兼容：不保留 UA 旧目录/旧名的兼容分支；不沿用旧 excavator 的契约。数据目录唯一：`.excavator/`。
- 钉死上游 5feed1f2；不同步上游、不提上游 PR；NOTICE 常在。
- 语料只有 wcp 与 cebreo；真实项目的源码、路径、输出不提交。

## 工具链
Node ≥ 22，pnpm（版本按 `package.json` 的 `packageManager`），vitest。三件套：`pnpm install --frozen-lockfile && pnpm -r build && pnpm test`。
