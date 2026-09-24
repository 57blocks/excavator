## Why

DevOps 要在 AWS 上运行 Excavator，方案是 Claude Code 接 Amazon Bedrock（`eu-central-1`，EU 推理配置）。他们希望把整套运行方式做成这个仓库里的部署代码，并打成镜像放进自己的 ECR。目前仓库没有任何可部署物：插件的 `dist` 不在 git 里，Claude Code 的版本、模型钉版、隔离参数都靠人记；仓库也没有 CI。

更关键的是，无人值守时"看起来跑了"不等于"真的跑对了"。2026-09-24 在 Claude Code 2.1.281 上做的两次探针说明了这一点：
- 用 `--bare --plugin-dir` 启动时，9 个 skill 都能列出来，但子 agent 为 0、MCP 没有注册，可用工具只剩 Bash、Read、Edit。full 模式派不出子 agent，却不会报明显的错。
- 从空目录启动（加 `--setting-sources user` 和 `disableAllHooks`）时，10 个子 agent、MCP 的 7 个工具、Task 和 Skill 工具都在。

另外，官方文档明确说：不加 `--bare` 的 `-p` 会话会执行项目 `.claude/settings.json` 里的 hooks、连接项目 `.mcp.json` 里的 server，而且没有信任确认。分析客户仓库时，这就是代码执行入口。

这些判断必须由确定性代码在每次运行时检查，不能靠操作人员自觉。

## What Changes

- 新增运行镜像。两阶段构建：先构建钉死 commit 的 Excavator，再装钉死版本的 Claude Code（`2.1.281`）。镜像内用非 root 用户，同时构建 amd64 与 arm64。镜像里只写死不敏感的开关类环境变量；模型 ID、区域、预算在运行时传入。镜像不含任何凭证、目标仓库代码或产物。
- 新增运行脚本 `deploy/run-excavator.mjs`：一个容器处理一个挂载的仓库、执行一次任务。
  - lazy 模式直接调用零模型的 `lazy-analyze.mjs`，不启动 Claude Code；
  - full 模式在 HEAD 未变时跳过，否则从空目录启动 Claude Code，使用固定的隔离与预算参数；
  - 跑完做确定性检查：插件和 MCP 是否加载、子 agent 是否齐全、运行是否出错、产物 commit 与模型记录是否正确；并独立重跑 `validate-graph.mjs` 统计结构问题和编造数；
  - 检查结果写成 `summary.json`，并以不同退出码区分成功、配置错误、运行失败、加载或产物检查失败、编造超阈值；任何失败都保留产物。
- 新增镜像自检 `deploy/selftest.sh`（不调模型、不需要凭证）和 CI workflow：打 tag 时跑仓库测试、构建两种架构、在两种架构上自检、通过 OIDC 推送到 ECR；ECR 参数未配置时只构建不推送。
- 新增部署契约文档 `docs/deploy.md`，写给 DevOps：`docker run` 用法、环境变量、退出码、产物、IAM 与网络清单、上线验收与升级流程。
- 修改 `plugin-identity` 的宿主要求：明确运行镜像使用 Claude Code 宿主，通过 `--plugin-dir` 加载镜像内预构建的检出，不构成第三个宿主，也不复制一份 skill。

**不在本次范围**：VM 或 ECS 等基础设施、IAM 策略本身、ECR 仓库的创建（属于 DevOps 的 IaC）；产物同步到 S3、定时或推送触发；VM 上的交互式问答；在容器里 clone 仓库（由 VM 负责，镜像不接触 git 凭证）。

## Capabilities

### New Capabilities

- `runner-image`：可部署的运行镜像与单次运行契约。覆盖镜像内容与钉版、运行时参数、启动隔离、运行后的确定性检查、退出码与产物，以及镜像的构建、自检与发布。

### Modified Capabilities

- `plugin-identity`：「只支持 Claude Code 与 Codex 两个宿主」补充运行镜像的定位——属于 Claude Code 宿主的一种打包方式，用 `--plugin-dir` 加载预构建检出，不新增宿主，不复制 skill。

## Impact

- **新增文件**：`deploy/Dockerfile`、`deploy/claude-settings.json`、`deploy/selftest.sh`、`deploy/run-excavator.mjs`、`.dockerignore`、`.github/workflows/runner-image.yml`、`docs/deploy.md`，以及 `tests/deploy/` 下的测试与合成样本。
- **不改动**：skills、agents、hooks、`packages/core` 与插件清单都不变；lazy 与 full 的产物格式不变。
- **外部依赖**：Docker buildx；GitHub Actions（仓库目前没有 CI）；`@anthropic-ai/claude-code@2.1.281`；ECR 仓库与 OIDC 角色由 DevOps 提供，未提供前 CI 只构建不推送。
- **验收的依赖**：真实模型的 Bedrock 冒烟需要 DevOps 开通的 Bedrock 权限，作为镜像的发布门，不作为本 change 的合并门（见 design「验收 Oracle」）。
- **AI-first 范围判定**：本 change 落的是安全与权限边界（启动隔离、非 root、无凭证）、机器可校验的运行契约（加载检查、产物检查、退出码）和可复现的构建。这些判断发生在模型运行之外或需要对模型的结果做独立核对，skill 或 prompt 无法可靠自证——探针已经证明，加载失败时模型照样会"运行"。
