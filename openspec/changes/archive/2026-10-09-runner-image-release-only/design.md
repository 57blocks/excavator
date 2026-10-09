## Context

`.github/workflows/runner-image.yml` 是仓库唯一的 workflow，有两个任务：`test`（仓库测试门：install、build、test）与依赖它的 `image`（构建、自检，发布触发下推送）。触发器有三种：`runner-v*` tag、手动 dispatch、改到部署相关路径的 PR。推送资格在 `image` 任务内的「Decide push eligibility」一步判定：必须是发布触发且四个镜像仓库变量齐全。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**
- PR 上只跑 `test`，`image` 在运行记录里显示为 skipped。
- 发布触发的行为（构建、自检、按资格推送、报告跳过原因）完全不变。
- 恢复 PR 上的镜像构建只需删一行。

**Non-Goals:**
- 不改 PR 触发的路径过滤，不把测试门扩到所有 PR。
- 不改推送资格判定与镜像标签规则。

## Decisions

**D1：在 `image` 任务上加任务级 `if`，条件写成发布触发的白名单。** 条件为 `github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/runner-v')`，与推送资格里「发布触发」的定义一致。不写成 `github.event_name != 'pull_request'`：之后若新增触发器（例如推到 main），白名单下镜像任务默认被跳过并在运行记录里可见，不会悄悄开始构建。
- 备选：删掉 PR 触发器。这样 PR 连测试门也不跑了，而这是部署改动在合入前唯一的 CI 测试，所以不选。
- 备选：删掉 `image` 任务。这样发布触发也失去镜像，恢复要整块加回，所以不选。
- 备选：`if: false`。发布同样被关掉，所以不选。

**D2：保留推送资格里「不是发布触发」的分支。** 在 D1 之后它不可达，但如果日后放宽 D1（例如恢复 PR 构建），它保证 PR 不推送并报告原因。规格仍按「镜像流程运行而不推送时报告原因」来写。

## Risks / Trade-offs

- [合入前不再由 CI 证明 Dockerfile 能构建、镜像能自检] → `docs/deploy.md` §5 已给出本地构建与自检命令，用镜像前照做。发布触发仍在推送前完成构建与自检，坏镜像推不出去。
- [本变更的 PR 无法在 PR 上演练镜像任务本身] → 验收只需证明 PR 上 `image` 被跳过、`test` 通过。发布路径的代码未改。

## Migration Plan

合入即生效。回滚方式：删掉 `image` 任务上的 `if`，同时恢复规格与 `docs/deploy.md` 的对应句子。
