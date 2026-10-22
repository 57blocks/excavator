## Why

仓库里没有合并前必过的检查：
- 唯一的工作流（运行镜像）只在部署相关文件改动时跑测试；
- `main` 没有分支保护，任何有写权限的人或会话都能直接推送；
- 全量门（构建、类型检查、引用检查、OpenSpec 校验、core 测试、全仓测试）与隐私检查只在 agent 本地跑，别的成员或会话开的 PR 没有任何关卡。

本地跑的门也漏平台差异：运行镜像工作流最近一次在 Linux 上跑测试，doc-map 的一个测试失败（期望的报错里路径被截断，而 Linux 的临时目录较短、不截断），本地 macOS 上一直是绿的。

## What Changes

- 新增工作流 `CI`：每个 PR、推到 `main` 与手动触发都在 Linux 上跑全量门，即 `AGENTS.md` 验证表所列全部检查的并集。
- 新增工作流 `Privacy`：PR（含编辑标题或正文）与手动触发时扫描这次改动要进仓库的文字：
  - 每个提交新增的行、提交信息、改动的路径、PR 的标题与正文；
  - 名单从两个仓库 secret 读取，仓库里不写任何名字；
  - 私有名字在 lockfile 之外处处禁止；语料名在 `openspec/`、`docs/` 与根目录 Markdown 之外禁止（验收记录里写明在哪个语料上验过是证据）；
  - 只打印每类来源的命中数，不打印命中的文字；名单缺失即失败。
- 修 doc-map 那个依赖临时目录长度的测试。
- 运行镜像工作流开头「这是仓库唯一的工作流」一句改为指向新工作流；`AGENTS.md` 写明 PR 合并前必过的两个检查。
- 合并后：设置两个 secret；`main` 开分支保护：
  - 必须走 PR；
  - `CI gate` 与 `Privacy scan` 两个检查必过，且分支要与 `main` 同步；
  - 管理员同样受限；
  - 禁止强推与删除。

## Capabilities

### New Capabilities

- `change-review`：一个改动进入 `main` 之前要经过哪些检查、由谁负责。本变更写入前两条：合并前必过的检查，以及不把名单写进仓库的隐私检查。

### Modified Capabilities

无。

## Impact

- 新增 `.github/workflows/ci.yml`、`.github/workflows/privacy.yml`、`scripts/ci/privacy-scan.mjs` 与它的测试；改 `tests/skill/test_doc_map.test.mjs` 一处、`.github/workflows/runner-image.yml` 开头注释、`AGENTS.md` 一段。
- 所有成员与会话的改动都要走 PR、过两个检查，不能再直接推 `main`。
- 从 fork 开的 PR 拿不到 secret，`Privacy scan` 会失败，需要维护者在本仓库的分支上重开。
- 不加人工批准的要求：审查与风险分级在下一步做。
