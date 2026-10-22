# change-review Specification

## Purpose
定义一个改动进入 `main` 之前要经过哪些检查、由谁负责：合并前必过的检查，以及不把名单写进仓库的隐私检查。

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
