## MODIFIED Requirements

### Requirement: 镜像内容钉死且不含凭证与产物

运行镜像 SHALL 包含一个已构建完成的 Excavator 检出（依赖与 `packages/core` 的构建产物齐全），且只对应一个记录在案的 commit；SHALL 包含一个记录在案的固定版本的 Claude Code，并关闭其一切更新途径；SHALL 提供 Node ≥ 22、git、`jq`，以及同时可用 `python` 与 `python3` 两个命令调用的 Python 3。镜像 SHALL 以固定 uid 的非 root 用户运行，并把 Excavator 检出暴露在该用户的 `$HOME/.excavator-plugin`；挂载进来的仓库属主与该用户不同时，git 操作 SHALL 仍然可用，包括关掉了用户级、系统级配置的 hotspots 历史读取。镜像 SHALL 以标签记录 Excavator 的 commit 与 Claude Code 的版本。镜像 MUST NOT 包含任何云凭证、模型凭证、git 凭证、目标仓库源码或 `.excavator/` 产物；模型 ID、区域与预算 MUST NOT 写死在镜像里。

#### Scenario: 版本与标签一致
- **WHEN** 在镜像里查询 Claude Code 版本与 Excavator 检出的 commit
- **THEN** 两者分别等于镜像标签记录的值，且 Claude Code 报告更新已被关闭

#### Scenario: 镜像里没有凭证与产物
- **WHEN** 检查镜像文件系统
- **THEN** 不存在 `.excavator/` 目录、云凭证文件或 Claude Code 登录凭证，默认用户不是 root

### Requirement: 镜像可自检且按固定规则发布

镜像 SHALL 提供不调用模型、不需要凭证的自检：版本与标签一致、插件清单校验通过、`python` 命令可用、`jq` 命令可用、在临时生成的小仓库上 Lazy 能产出知识图谱、挂载的仓库属主与容器用户不同时 git 仍可用，且按 hotspots 的方式（关掉用户级、系统级配置）读一个属主不同的仓库的历史能产出结果。发布流程 SHALL 运行仓库测试门、确认构建来自干净的检出、构建 `linux/amd64` 镜像并运行自检；只有在发布触发（打 tag 或手动触发）下且全部通过后，才以不可覆盖的标签 `<插件版本>-<短 commit>` 推送到镜像仓库。镜像构建与自检 SHALL 只在发布触发下运行。改到部署相关文件的 PR SHALL 只运行仓库测试门，MUST NOT 构建镜像、运行自检或推送，且镜像这一步在运行记录中 SHALL 显示为跳过。镜像流程运行而不推送时——不是发布触发，或镜像仓库参数未配置——流程 SHALL 明确报告跳过了推送及原因。

#### Scenario: 未配置镜像仓库
- **WHEN** 在没有配置镜像仓库参数的情况下触发发布流程
- **THEN** 镜像完成构建与自检，流程报告推送被跳过并说明缺少的参数，而不是失败或静默成功

#### Scenario: PR 运行
- **WHEN** 一个改到部署相关文件的 PR 触发流程
- **THEN** 测试门运行；镜像构建与自检不运行，在运行记录中显示为跳过，也不推送任何镜像

#### Scenario: 自检失败不推送
- **WHEN** 自检失败
- **THEN** 不推送任何镜像

#### Scenario: 自检覆盖 skill 依赖的命令与属主不同的仓库
- **WHEN** 在镜像里运行自检
- **THEN** 自检检查 `jq` 能计算，并在一个被 git 视为属主不同的临时仓库上运行 hotspots 脚本、得到产物；缺少 `jq` 或 hotspots 被 git 以属主为由拒绝时，对应检查失败
