## Why

上一步让每个 PR 必须通过全量门与隐私检查，但合并前没有人或模型读过改动本身：
- agent 写的 PR 由同一个 agent 合并，写的会话也是唯一读过它的会话；
- 改检查本身的 PR（工作流、隐私扫描器）与改一行文档的 PR 走同一条路，而前者能让后面所有检查失效；
- 没有地方写这个仓库的审查要看什么：本仓库最贵的错是报告编造事实、检查本该红却绿、名单进了仓库，这些都不是通用审查默认会盯的；
- PR 正文没有固定的格式，看不出测了什么、检查会漏什么、出事怎么回滚。

托管的 Code Review 服务需要组织的 Team 或 Enterprise 方案，并由 Owner 开启，这一步不依赖它。本地的 `/code-review` 不读 `REVIEW.md`。

## What Changes

- 新增根目录 `REVIEW.md`（英文）：
  - 审查的规则：这个仓库里什么算 Important、什么是 Pre-existing、证据要求、按类报告、Nit 上限、不报什么、每次都查什么、总结的写法。日后开启托管服务时它也直接适用。
  - 审查的流程：按路径定的三档风险与各档合并前的要求；每条发现都要回应；收敛规则（后续轮只审 PR 自己的新提交，不重复，最多三轮）。流程放在这里而不放在 `AGENTS.md`，因为 `REVIEW.md` 本身是高档文件，中档 PR 放宽不了它。
- 新增审查代理 `.claude/agents/reviewer.md`（英文）：
  - 干净上下文、模型 opus、只读；
  - 按 `main` 上的 `REVIEW.md` 与 `AGENTS.md` 审一个 PR 或一个 git 范围；
  - PR 的发现作为行内评论发到 PR 上；范围的发现只打印，供下一步的评测使用。
- 新增 PR 模板 `.github/pull_request_template.md`：Summary、Testing、Risk tier、How to revert。
- `AGENTS.md` 新增「审查」一节：指向 `REVIEW.md` 的流程、PR 正文按模板、由审查代理审查。
- `main` 的分支保护加上「所有讨论已解决才能合并」。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-review`：新增五条：按路径定风险档、中高档由干净上下文的审查代理审查、每条发现都要回应、审查要收敛、PR 正文写明测试、风险档与回滚方式。

## Impact

- 新增 `REVIEW.md`、`.claude/agents/reviewer.md`、`.github/pull_request_template.md`；改 `AGENTS.md` 一节；改分支保护一项。
- 中高档 PR 合并前多一轮或几轮审查，每轮是一次 opus 子代理的花费。
- 高档 PR（改检查或审查本身）由用户合并，无人值守的连续工作会在这类 PR 处停下。
- 不加代码：风险档、回应与收敛都是写给 agent 的流程，GitHub 只强制「讨论都已解决」。
- 低档只含文档：`docs/` 下被测试读取的 JSON schema 这类文件归中档。
