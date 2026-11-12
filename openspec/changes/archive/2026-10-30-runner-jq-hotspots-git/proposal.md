## Why

在分析主机上按部署文档用运行镜像跑了一次真实项目，有两步在容器里稳定失败，而镜像自检 12 项全过：

- 镜像里没有 `jq`。unused-code、hotspots、doc-map、chat、tour、prd-report 和 full 模式的 skill 都让模型运行 `jq`。unused-code 在列出候选之后停下，doc-map 绕过去跑完但保留的代码位置和证据文件明显变少。
- hotspots 读不了属主不同的仓库。部署布局里仓库归 root、容器用户是固定 uid 的普通用户，镜像为此在系统级 git 配置里登记了可信目录 `*`。但 hotspots 为了结果只由 HEAD 决定，读历史时关掉了用户级和系统级配置，这条登记也一起被关掉，git 以「可疑属主」拒绝。自检只查了系统配置里有这一项，没有按 hotspots 的方式调用 git。

## What Changes

- 运行镜像安装 `jq`，自检新增一项：`jq` 在 PATH 上且能计算。
- hotspots 发现仓库的那一次 git 调用，以命令级配置把被分析的这个仓库（真实路径）登记为可信；其余读取不变，仍不读用户级和系统级配置。
- 自检新增一项：在一个被 git 视为属主不同的临时仓库上运行 hotspots 脚本，必须产出结果。自检从 12 项变为 14 项，部署文档同步。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `runner-image`：镜像提供的工具加上 `jq`；属主不同时 git 可用的要求覆盖到 hotspots 的历史读取；自检加上 `jq` 与 hotspots 读取属主不同仓库两项。
- `change-hotspots`：关掉机器级配置时，属主不同的仓库仍按真实路径单独放行，只放行这一个仓库。

## Impact

- `deploy/Dockerfile`、`deploy/selftest.sh`、`docs/deploy.md`
- `skills/excavator/hotspots/history.mjs`、`tests/skill/excavator/test_hotspots.test.mjs`
- 已发布的镜像不变；新镜像需要重新构建并在主机上重新加载才生效。
