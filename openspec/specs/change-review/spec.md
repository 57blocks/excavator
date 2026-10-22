# change-review Specification

## Purpose
定义一个改动进入 `main` 之前要经过哪些检查、由谁负责：合并前必过的检查、不把名单写进仓库的隐私检查、按路径定的风险档、干净上下文的审查与对发现的回应，以及审查怎样收敛。

## Requirements

### Requirement: 合并前必过的检查

每个进入 `main` 的改动 SHALL 经过一个 PR，并在合并前于 Linux 上通过全量门：依赖按 lockfile 安装、全部包构建、类型检查、引用检查、OpenSpec 严格校验、core 测试与全仓测试。全量门 SHALL 是 `AGENTS.md` 验证表所列全部检查的并集，不按改动范围挑选。`main` SHALL 受分支保护：不能直接推送、强推或删除；全量门与隐私检查是必过的检查，且 PR 分支 SHALL 与 `main` 同步后才能合并；管理员 MUST NOT 例外。

#### Scenario: 测试失败的 PR
- **WHEN** 一个 PR 的某个测试在 Linux 上失败
- **THEN** 全量门检查是红的，这个 PR 不能合并

#### Scenario: main 前进之后
- **WHEN** 一个 PR 通过检查之后 `main` 合入了别的改动
- **THEN** 这个 PR 要先与 `main` 同步、在新的内容上重新通过检查才能合并

### Requirement: 隐私检查不把名单写进仓库

隐私检查 SHALL 扫描一个 PR 要带进仓库的文字：PR 内每个提交新增的行（包括合并提交自己写进的行，以及后来又被删掉的行）、提交信息、作者与提交者、改动的路径、PR 的标题、分支名与正文。只扫这个 PR 带来的文字，不扫 `main` 已有的内容。PR 的标题、分支名与正文 SHALL 在检查运行时读取，不取自触发检查的事件。名单 SHALL 只存放在仓库 secret 里，MUST NOT 写进仓库的任何文件。私有名字在 lockfile 之外处处禁止；语料名在 `openspec/`、`docs/` 与根目录 Markdown 之外禁止。检查 SHALL 只输出每类来源的命中数，MUST NOT 输出命中的文字；名单缺失或为空时检查 SHALL 失败，而不是当作没有命中。PR 的标题或正文被编辑后 SHALL 重新扫描。

#### Scenario: 名单缺失
- **WHEN** 仓库没有设置名单的 secret（或 PR 来自拿不到 secret 的 fork）
- **THEN** 隐私检查失败，并写明名单不可用

#### Scenario: 验收记录里写语料名
- **WHEN** 一个 PR 在 `openspec/` 的验收记录里写了某个语料名，又在一个测试文件里写了同一个名字
- **THEN** 隐私检查只把测试文件那一处计为命中并失败，输出里没有这个名字

#### Scenario: 合并提交写进又删掉的行
- **WHEN** PR 分支合入 `main` 时在解决冲突的内容里写了一个私有名字，下一个提交又把它删掉
- **THEN** 隐私检查把这一行计为命中并失败

#### Scenario: 重跑读当前的正文
- **WHEN** PR 正文里的私有名字被删掉后，有人重跑了之前那次失败的检查
- **THEN** 检查读的是当前的正文，不再计这一处

### Requirement: 按触及的路径定风险档

一个 PR 的风险档 SHALL 由它触及的路径决定，取其中最高的一档，作者 MUST NOT 自选：
- 高档：定义检查与审查本身的路径，即 `.github/`、`scripts/ci/`、`REVIEW.md` 与 `.claude/agents/reviewer.md`；
- 低档：只改文档，即 `openspec/` 与 `docs/` 下的 Markdown、`.openspec.yaml`，以及根目录下 `AGENTS.md`、`CLAUDE.md`、`REVIEW.md` 以外的 Markdown；
- 中档：其余。

低档在必过检查通过后即可合并；中档还要经过审查；高档在审查之后 SHALL 由用户合并，agent MUST NOT 自行合并。风险档、由谁审查、回应与收敛的规则 SHALL 写在高档路径的文件里，使中档 PR 放宽不了它们。

#### Scenario: 改了工作流的 PR
- **WHEN** 一个 PR 改了 `.github/workflows/ci.yml` 和一份 OpenSpec 文档
- **THEN** 它是高档，审查之后由用户合并

#### Scenario: 只改 OpenSpec 文档的 PR
- **WHEN** 一个 PR 只改了 `openspec/` 下的文件
- **THEN** 它是低档，必过检查通过即可合并，不需要审查

#### Scenario: 改了 skill 的提示词
- **WHEN** 一个 PR 改了 `skills/` 下某个 skill 的 Markdown
- **THEN** 它是中档，要经过审查

#### Scenario: 改了 docs 下被测试读取的文件
- **WHEN** 一个 PR 只改了 `docs/` 下一个被测试读取的 JSON schema
- **THEN** 它是中档，要经过审查

### Requirement: 中高档 PR 合并前由干净上下文的审查代理审查

中高档 PR 合并前 SHALL 由一个干净上下文的审查代理审查。写这个改动的会话 MUST NOT 审自己。审查代理 SHALL 按 `main` 上的 `REVIEW.md` 与 `AGENTS.md` 审；PR 对这两个文件的改动是被审的内容，不是审查规则。每条发现 SHALL 标明 Important、Nit 或 Pre-existing，写明 file:line 证据与失败的输入和结果；能定位到改动行的发现 SHALL 作为该行的行内评论发到 PR 上。总结的第一句 SHALL 是各档的计数。审查代理 MUST NOT 修改文件、提交、批准、解决讨论或合并。审查评论是公开的，隐私检查不读它们，所以审查代理 SHALL 只在它所审的那个提交上最近一次隐私检查通过之后才发评论；没发出去的一轮不算数，隐私检查通过后重跑同一轮。

#### Scenario: 有发现
- **WHEN** 审查代理审一个中档 PR，发现一处会让检查本该失败却通过的逻辑
- **THEN** 它在对应行发一条标为 Important 的行内评论，写明 file:line、什么输入会让检查错误地通过，总结第一句是各档计数

#### Scenario: 没有发现
- **WHEN** 审查代理没有发现
- **THEN** 它仍发一条总结，第一句写明各档都是 0、不需要修改

#### Scenario: PR 改了审查规则
- **WHEN** 一个 PR 删掉了 `REVIEW.md` 里的一条必查项
- **THEN** 审查代理仍按 `main` 上的 `REVIEW.md` 审，并把这处删除当作被审的改动

#### Scenario: 隐私检查还没通过
- **WHEN** 审查代理审完时，它所审的提交上的隐私检查是红的，或等了十分钟仍没跑完
- **THEN** 它不在 PR 上发任何评论，把发现交回调用方；作者让隐私检查通过后重跑这一轮，这一轮不计入轮数上限

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

第一轮 SHALL 审整个改动。之后的轮次 SHALL 只审 PR 自己在上一轮审过的提交之后的新提交，不含从 `main` 合入的内容，并且 MUST NOT 重复已经提出过的发现。只有上一轮有 Important 并且为此改了代码，或者 PR 自己的新提交触及中高档路径时，才 SHALL 再审一轮；新提交只触及低档路径时不再审。一个 PR 最多审三轮；第三轮之后无论哪种原因还需要再审，都 SHALL 停下，不合并，向用户说明并重新考虑做法。

#### Scenario: 修完 Important 之后
- **WHEN** 第一轮有一条 Important，作者推了修复的提交
- **THEN** 第二轮只审这个修复提交，不再提第一轮已提出的发现

#### Scenario: 第三轮仍有 Important
- **WHEN** 第三轮审查仍报出 Important
- **THEN** 这个 PR 不合并，agent 停下向用户说明

#### Scenario: 第三轮之后又改了中档路径
- **WHEN** 第三轮没有 Important，但之后 PR 又推了一个改 `packages/` 的提交
- **THEN** 这个 PR 不合并，agent 停下向用户说明

#### Scenario: 合入 main 之后
- **WHEN** 上一轮之后，PR 只合入了最新的 `main`，合并时没有解决冲突
- **THEN** 不再审一轮：从 `main` 带来的改动不算 PR 自己的新提交

#### Scenario: 之后只改了验收记录
- **WHEN** 最后一轮之后的新提交只改了 `openspec/` 下的验收记录
- **THEN** 不再审一轮

### Requirement: PR 正文写明测试、风险档与回滚方式

PR 正文 SHALL 包含四节：Summary；Testing，写跑了哪些命令与结果，以及检查会漏掉什么；Risk tier，写明档位与触及的高档路径；How to revert，写明回滚的做法以及回滚撤不掉的设置。

#### Scenario: 改了分支保护的 PR
- **WHEN** 一个 PR 在合并时还改了分支保护或 secret
- **THEN** How to revert 写明 revert 合并提交撤不掉这些设置，以及怎样手动恢复
