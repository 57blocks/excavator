## ADDED Requirements

### Requirement: 按触及的路径定风险档

一个 PR 的风险档 SHALL 由它触及的路径决定，取其中最高的一档，作者 MUST NOT 自选：
- 高档：定义检查与审查本身的路径，即 `.github/`、`scripts/ci/`、`REVIEW.md` 与 `.claude/agents/reviewer.md`；
- 低档：只改 `openspec/`、`docs/` 下的文件，或根目录下 `AGENTS.md`、`CLAUDE.md`、`REVIEW.md` 以外的 Markdown；
- 中档：其余。

低档在必过检查通过后即可合并；中档还要经过审查；高档在审查之后 SHALL 由用户合并，agent MUST NOT 自行合并。

#### Scenario: 改了工作流的 PR
- **WHEN** 一个 PR 改了 `.github/workflows/ci.yml` 和一份 OpenSpec 文档
- **THEN** 它是高档，审查之后由用户合并

#### Scenario: 只改 OpenSpec 文档的 PR
- **WHEN** 一个 PR 只改了 `openspec/` 下的文件
- **THEN** 它是低档，必过检查通过即可合并，不需要审查

#### Scenario: 改了 skill 的提示词
- **WHEN** 一个 PR 改了 `skills/` 下某个 skill 的 Markdown
- **THEN** 它是中档，要经过审查

### Requirement: 中高档 PR 合并前由干净上下文的审查代理审查

中高档 PR 合并前 SHALL 由一个干净上下文的审查代理审查。写这个改动的会话 MUST NOT 审自己。审查代理 SHALL 按 `main` 上的 `REVIEW.md` 与 `AGENTS.md` 审；PR 对这两个文件的改动是被审的内容，不是审查规则。每条发现 SHALL 标明 Important、Nit 或 Pre-existing，写明 file:line 证据与失败的输入和结果；能定位到改动行的发现 SHALL 作为该行的行内评论发到 PR 上。总结的第一句 SHALL 是各档的计数。审查代理 MUST NOT 修改文件、提交、批准、解决讨论或合并。

#### Scenario: 有发现
- **WHEN** 审查代理审一个中档 PR，发现一处会让检查本该失败却通过的逻辑
- **THEN** 它在对应行发一条标为 Important 的行内评论，写明 file:line、什么输入会让检查错误地通过，总结第一句是各档计数

#### Scenario: 没有发现
- **WHEN** 审查代理没有发现
- **THEN** 它仍发一条总结，第一句写明各档都是 0、不需要修改

#### Scenario: PR 改了审查规则
- **WHEN** 一个 PR 删掉了 `REVIEW.md` 里的一条必查项
- **THEN** 审查代理仍按 `main` 上的 `REVIEW.md` 审，并把这处删除当作被审的改动

#### Scenario: 审一个 git 范围
- **WHEN** 调用方给审查代理一个 git 范围而不是 PR
- **THEN** 它只打印发现，格式与发到 PR 上的相同，不向 GitHub 写任何内容

### Requirement: 每条发现都要回应

作者 SHALL 回应每一条发现：修掉的，回复修复所在的提交；不修的，回复理由（错的、有意的或无关紧要）。回复之后 SHALL 解决这个讨论。`main` 的分支保护 SHALL 要求所有讨论都已解决才能合并。

#### Scenario: 还有未解决的讨论
- **WHEN** PR 上还有一个未解决的审查讨论
- **THEN** 这个 PR 不能合并

#### Scenario: 不修
- **WHEN** 作者认为一条发现是错的
- **THEN** 作者在讨论里写明为什么错，再解决讨论

### Requirement: 审查要收敛

第一轮 SHALL 审整个改动。之后的轮次 SHALL 只审上一轮审过的提交之后的新提交，MUST NOT 重复已经提出过的发现。只有上一轮有 Important 并且为此改了代码，或者新提交触及中高档路径时，才 SHALL 再审一轮；新提交只触及低档路径时不再审。一个 PR 最多审三轮；第三轮仍有 Important 时 SHALL 停下，不合并，向用户说明并重新考虑做法。

#### Scenario: 修完 Important 之后
- **WHEN** 第一轮有一条 Important，作者推了修复的提交
- **THEN** 第二轮只审这个修复提交，不再提第一轮已提出的发现

#### Scenario: 第三轮仍有 Important
- **WHEN** 第三轮审查仍报出 Important
- **THEN** 这个 PR 不合并，agent 停下向用户说明

#### Scenario: 之后只改了验收记录
- **WHEN** 最后一轮之后的新提交只改了 `openspec/` 下的验收记录
- **THEN** 不再审一轮

### Requirement: PR 正文写明测试、风险档与回滚方式

PR 正文 SHALL 包含四节：Summary；Testing，写跑了哪些命令与结果，以及检查会漏掉什么；Risk tier，写明档位与触及的高档路径；How to revert，写明回滚的做法以及回滚撤不掉的设置。

#### Scenario: 改了分支保护的 PR
- **WHEN** 一个 PR 在合并时还改了分支保护或 secret
- **THEN** How to revert 写明 revert 合并提交撤不掉这些设置，以及怎样手动恢复
