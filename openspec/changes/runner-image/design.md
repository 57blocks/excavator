## Context

动机见 proposal.md「Why」，行为契约见 `specs/runner-image/spec.md`。这里只列影响做法的现状与约束。

- **插件的可运行形态**：Git 检出里没有 `node_modules` 与 `packages/core/dist`，MCP 与各个脚本都依赖构建产物。skill 找插件根时只探测三处：`${CLAUDE_PLUGIN_ROOT}`、`$HOME/.excavator-plugin`、`~/.agents/skills` 的 realpath（`plugin-identity`）。skill 里有 4 处调用 `python`（不是 `python3`）；Python 脚本只用标准库。tree-sitter 语法包都带 linux-x64 与 linux-arm64 预编译，但实现时查 ELF 头发现：锁文件里 tree-sitter-java、-ruby、-cpp、-typescript 与 -javascript@0.23.1 这 5 个包的 `linux-arm64` 预编译实际是 x86-64 二进制，在 arm64 上加载失败，会回退到 node-gyp 源码编译。所以构建阶段需要 python3 与 C/C++ 工具链；运行阶段不需要。
- **运行时事实**：
  - lazy 由 `skills/excavator/lazy-analyze.mjs` 单独完成，不调用模型。
  - full 由宿主按 `skills/excavator/SKILL.md` 编排子 agent；跑完会清理 `.excavator/intermediate/`（只保留 `scan-result.json`），所以"每个批次都有产物"只能由编排过程自己保证，事后看不到。
  - full 产物在图谱上打 `project.pipelineVersion = excavator-annotate/1`（`annotate-graph.mjs` 导出的 `PIPELINE_VERSION`），lazy 打 `lazy-fact-graph/2`；`meta.json` 记录 `gitCommitHash`。
  - 模型名来自 `HOST_MODEL_ENV_VARS`（含 `ANTHROPIC_MODEL`），都没设时记成 `unknown`。
  - summary-verifier 把结论写在节点的 `verification` 上（verified / unverified / contradicted / dirty），关闭核验时写 `project.verification = "skipped"`。
  - `validate-graph.mjs` 会打开源码逐条核对代码位置与证据；它的默认输出路径在 `.excavator/intermediate/` 下，而且退出码恒为 0，发现的问题都作为数据写进报告（`counts`、`issues[]`）。
- **Claude Code 的行为**（2.1.281，官方文档与 2026-09-24 本地探针）：
  - `-p` 会话不显示信任确认。不加 `--bare` 时，会执行项目 `.claude/settings.json` 里的 hooks、连接项目 `.mcp.json` 里的 server，项目 skill 自带的 hooks 与 `allowed-tools` 也会生效。
  - `--bare` 会跳过项目内容，但项目 settings 里的 `env` 仍会生效；`--setting-sources user` 让 Claude Code 完全不读项目的 settings 与 `.mcp.json`。
  - 探针结果：`--bare --plugin-dir` 下只有 9 个 skill，子 agent 为 0、MCP 未注册，工具只剩 Bash/Read/Edit；从空目录启动并加 `--setting-sources user` 与 `disableAllHooks` 时，10 个子 agent、MCP 的 7 个工具、`Task` 与 `Skill` 工具都在。
  - `stream-json` 的 `system/init` 事件给出 `plugins`、`plugin_errors`、`mcp_servers`、`agents`、`tools`；最终 `result` 事件给出 `is_error`、`permission_denials`、`subagent_stats`、`modelUsage`（四类 token 与估算花费）、`total_cost_usd`。
- **部署方的约束**：Bedrock 位于 `eu-central-1`，使用 EU 推理配置；ECR 与 OIDC 角色由 DevOps 提供；仓库目前没有 CI。

## Goals / Non-Goals

**Goals:**
- 一个镜像同时满足 VM 上的 `docker run` 与今后的 ECS/CodeBuild，运行契约只有一份。
- 每次运行都由确定性代码判定可信与否，失败只以退出码与摘要表达，不删除也不改写产物。
- 大部分验收可以在没有凭证、不调模型的情况下完成；只有真实模型冒烟依赖 Bedrock。

**Non-Goals:**
- 不在镜像里 clone 仓库，不同步 S3，不做调度。
- 不支持订阅登录：镜像是 Bedrock 专用的。
- 不移植 hooks，不提供交互式问答入口：full 运行时 hooks 全部关闭，MCP 只作为"插件完整加载"的信号。
- 不改 skills、agents、core 的任何行为。

## Decisions

### D1 部署物是镜像，基础设施不进本仓库

本仓库只拥有镜像定义、运行脚本、自检、CI 和部署契约文档。VM、IAM、VPC、ECR 仓库属于 DevOps 的 IaC。理由：镜像版本应与插件 commit 一一对应、随代码演进；而账号 ID、VPC、SCP 这类信息不应进入产品仓库。

一个容器处理一个仓库、执行一次任务，挂载点固定：
- `/work/repo`：目标仓库，可写。产物写回它的 `.excavator/`。
- `/work/out`：运行输出，可写。放 `run.jsonl`、`validation.json`、`validated-graph.json`、`summary.json`。

备选方案是在容器里 clone。它需要把 git 凭证带进容器，并且和 VM 上保留的 `.excavator/` 冲突（增量运行依赖上一次的产物），所以不采用。

### D2 镜像构成

**两阶段构建**，基础镜像为 `node:22-bookworm-slim`：
- 构建阶段：安装 python3、make、g++、gcc（原因见 Context），`corepack` 启用仓库钉的 pnpm，执行 `pnpm install --frozen-lockfile && pnpm -r build`。工具链只存在于构建阶段，不进运行镜像。
- 运行阶段：安装 git、python3、python-is-python3、ca-certificates；用 `npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` 装 Claude Code（ARG 默认 `2.1.281`）；拷入构建好的检出到 `/opt/excavator`；创建 uid 为 10001 的非 root 用户，并在其 `$HOME` 下建软链 `.excavator-plugin → /opt/excavator`；以 root 执行 `git config --system --add safe.directory '*'`。

关于 `safe.directory`：挂载进来的仓库属主通常不是 10001，git 会报 dubious ownership。这项检查防的是不可信的 `.git/config`，例如用 `core.fsmonitor` 执行命令。契约要求 `/work/repo` 是运维方自己 clone 的仓库：clone 不会复制远端的配置与 hooks，所以 `.git` 可信，系统级放行是安全的。`/work/repo` 不能是随意拷来的 `.git`，这一点写进契约。

容器固定以 uid 10001 运行，不支持用 `--user` 覆盖，否则 `$HOME` 不可写，Claude Code 无法写入自己的状态文件。宿主上的挂载目录需对 uid 10001 可写。

**写死在镜像里的环境变量**（都是不敏感的开关）：`CLAUDE_CODE_USE_BEDROCK=1`、`DISABLE_UPDATES=1`、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`、`CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`、`MCP_TOOL_TIMEOUT`、`BASH_DEFAULT_TIMEOUT_MS`、`BASH_MAX_TIMEOUT_MS`。

**`deploy/claude-settings.json`**：放到 `~/.claude/settings.json`，内容为 `skipWebFetchPreflight: true`，并在 `permissions.deny` 中禁用 `WebFetch` 与 `WebSearch`。

**OCI 标签**：`org.opencontainers.image.revision` 记录 Excavator commit；另设一个自定义标签记录 Claude Code 版本。

**`.dockerignore`**：排除 `.git`、`.excavator`、`node_modules`、`dist`、`.claude/settings.local.json`、`.codex`、`test-repo`、`.worktrees`、`coverage`。commit 由构建参数传入，不从 `.git` 读取。

**备选方案：**
- 基础镜像用 `amazonlinux:2023`：没有 `python-is-python3`，Node 22 需要另装。
- 用官方安装脚本 `curl | bash -s <版本>` 装 Claude Code：多一个远程脚本执行步骤；npm 包是同一个原生二进制，版本也可以精确钉住。
- 用 apt 仓库装 Claude Code：只能按渠道安装，不能钉到具体版本。
- 单阶段构建：会把构建工具与缓存带进运行镜像。

**架构**：只构建 `linux/amd64`。镜像用于部署到 AWS，EC2 默认是 x86；Dockerfile 本身不区分架构（构建阶段的编译工具链也覆盖 arm64），若改用 Graviton，只需在 CI 里加一个原生 `ubuntu-24.04-arm` 的构建与自检。

### D3 full 模式的启动方式与隔离

运行脚本在 `/tmp` 下新建一个空目录作为 cwd，然后以如下参数启动：

```
claude -p "/excavator:excavator /work/repo --mode=full"      # 需要强制重建时改为 --full（规则见下）
  --plugin-dir /opt/excavator
  --setting-sources user --settings '{"disableAllHooks": true}'
  --model "$ANTHROPIC_MODEL"
  --permission-mode bypassPermissions --permission-prompts none
  --max-budget-usd "$EXCAVATOR_MAX_BUDGET_USD" --no-session-persistence
  --output-format stream-json --verbose            # 事件写入 /work/out/run.jsonl
```

`ANTHROPIC_MODEL` 同时导出到进程环境，让 `annotate-graph.mjs` 能从环境变量里读到并记录模型名。

**参数说明：**
- **cwd 不在目标仓库内**：目标仓库的 `.claude/`、`.mcp.json`、`CLAUDE.md` 都不会被当作项目内容发现。`--setting-sources user` 与 `disableAllHooks` 作为额外保险。插件自己的 hooks 也一并关闭：它们在无人值守的 full 运行中只会给出"建议运行 `/excavator`"之类的提示，没有用处。
- **什么时候传 `--mode=full`，什么时候传 `--full`**：
  - 现有产物是 full 产物且 commit 已变：传 `--mode=full`，skill 会自己选择增量更新。
  - 设置了 `EXCAVATOR_FORCE`，或现有产物不是 full 产物（没有产物，或只有 Lazy 产物）：传 `--full`，强制完整重建。
  - 理由：`SKILL.md` 的决策表里，"已有图谱且 commit 未变"会走到向用户提问的分支。Lazy 产物也算"已有图谱"，无人值守时模型会停在提问上，所以必须显式强制重建。
- **MCP 的根目录**：MCP server 会绑定到 cwd 这个空目录。full 流程靠脚本完成，不调用 MCP 工具，所以 MCP 只作为"插件完整加载"的信号来检查。

**`bypassPermissions` 的取舍**：Excavator 会跑大量形态各异的 shell 片段，逐条列允许清单很脆弱。`dontAsk` 加允许清单会在第一次遇到新写法时静默拒绝；`auto` 模式要额外调用分类模型，拒绝结果也不可预测。采用 bypass 的代价是：被分析代码里的提示注入可以让模型在容器内执行任意命令。所以安全边界放在容器和 VM 层：非 root 用户、镜像内无凭证、实例角色只有 Bedrock Invoke 权限、git 凭证只读、限制对外网络、每次用一次性工作副本。这些写进部署契约。

**不采用的隔离方案：**
- `--bare`：探针已证明它会让 full 模式失去子 agent 与 MCP。
- 删掉工作副本里的 `.claude/`、`.mcp.json` 再跑：会改变被分析的源码树。
- 在仓库目录里运行，只加 `--setting-sources user`：项目里的 skill、agent 和 `CLAUDE.md` 仍会被发现，项目 skill 自带的 hooks 仍会生效。

### D4 运行脚本与检查

用 Node 编写 `deploy/run-excavator.mjs`，与仓库其他脚本同栈，检查逻辑都拆成纯函数，便于用 vitest 测试。

**运行参数**：`EXCAVATOR_MODE`（`lazy`｜`full`）、`EXCAVATOR_MAX_BUDGET_USD`、`EXCAVATOR_FORCE`、`EXCAVATOR_MAX_CONTRADICTED`（默认 0）、`EXCAVATOR_TIMEOUT_MINUTES`（默认 180），以及 Claude Code 自己的 `AWS_REGION`、`ANTHROPIC_MODEL`。full 模式必须提供区域、模型 ID 与预算。`ANTHROPIC_DEFAULT_*_MODEL` 等别名钉版变量由运维按需传入，运行脚本不读取，只随环境原样传给 Claude Code。

凡是检查的输入缺失，一律判失败，不判通过（没有第四态）：
- 期望 agent 集合为空；
- 复核报告或复核后的图不存在，或 `validate-graph` 以非 0 退出（运行前先删除输出目录里残留的旧复核文件）；
- `result` 事件里缺少 `permission_denials` 或 `subagent_stats.failed`（Claude Code 版本已钉死，字段缺失说明它的输出格式变了）。

**执行流程：**
1. 校验参数；记录 HEAD（git 的属主放行已在镜像的系统配置里完成，见 D2）。
2. **lazy**：执行 `node /opt/excavator/skills/excavator/lazy-analyze.mjs /work/repo`，退出码非 0 即判运行失败。
3. **full**：
   - **是否跳过**：现有图谱的 `project.pipelineVersion` 等于从 `annotate-graph.mjs` 导入的 `PIPELINE_VERSION`、`meta.gitCommitHash` 等于 HEAD、且未设 `EXCAVATOR_FORCE` 时跳过。版本号直接导入，不写死。
   - **超时**：超过墙钟上限时先发 SIGINT，宽限后再发 SIGTERM，判运行失败。
4. **检查**：
   - **加载**：从 `system/init` 读取：
     - excavator 插件的路径是 `/opt/excavator`，`plugin_errors` 为空；
     - `mcp_servers` 中 excavator 的 MCP 已连接；
     - `agents` 包含 `excavator:<名字>` 的完整集合，期望集合在运行时从 `/opt/excavator/agents/*.md` 的文件名读出；
     - `tools` 中有 `Task` 或 `Agent`（不同版本名字不同，两者都认）。
   - **运行**：`result` 事件中 `is_error` 为 false，`permission_denials` 为空，`subagent_stats.failed` 为 0。
   - **产物**：`meta.gitCommitHash` 等于第 1 步记录的 HEAD；图谱记录的模型等于 `ANTHROPIC_MODEL`。
   - **独立复核**：运行 `validate-graph.mjs /work/repo --graph .excavator/knowledge-graph.json --out /work/out/validated-graph.json --report /work/out/validation.json`，路径全部显式给出，避免写进 `.excavator/`。
     - `issues` 数大于 0：判加载或产物检查失败；
     - 在复核后的图里，统计节点与边中 `verification === "contradicted"` 的总数，超过阈值判编造；
     - `project.verification === "skipped"` 也判编造。
5. **摘要**：写 `summary.json`。四类 token 与估算花费取自 `modelUsage`，缓存读取为 0 时加警告。

**退出码**：按阶段顺序取第一个失败阶段的码：配置（2）→ 加载（4）→ 运行（3）→ 产物与结构（4）→ 编造（5）。加载排在运行之前，是因为插件没加载完整时，运行往往也会跟着失败，报加载失败才指向根因。摘要仍记录每一项检查的结论，不因前面失败而省略后面还能做的检查。

### D5 不调模型的自检

`deploy/selftest.sh` 在镜像内以默认用户执行：
- Claude Code 版本、检出的 commit 与镜像标签一致；
- `claude plugin validate /opt/excavator` 通过；
- `python --version` 可用；`$HOME/.excavator-plugin` 指向检出；系统 git 配置里有 `safe.directory=*`；
- 新建一个临时 git 仓库，跑 lazy 能产出 `knowledge-graph.json`（属主不同的真实挂载由 O6 覆盖）；
- **加载探针**：以 full 模式启动一次，要求 `system/init` 通过加载检查，随后运行以失败结束。

加载探针不依赖"没有凭证"：在带实例角色的 EC2 上，容器能从 IMDS 取到真实凭证，那样就会真的调用 Bedrock。所以探针固定这样做：
- 把 `ANTHROPIC_BEDROCK_BASE_URL` 指向容器内一个立即返回 403 的本地端口；
- 给一组假的静态凭证；
- 设 `AWS_EC2_METADATA_DISABLED=true`，关掉 IMDS。

这样在任何宿主上都不会发出真实的模型请求，而且初始化完成后运行一定失败。

### D6 CI 与发布

新建 `.github/workflows/runner-image.yml`：
- **触发**：三种触发都跑同一套完整流程——推送 `runner-v*` tag、手动触发，以及改到 `deploy/**`、`.dockerignore`、这个 workflow 文件、`package.json` 或 `pnpm-lock.yaml` 的 PR。PR 也跑完整流程，是因为 GitHub 的手动触发只对已在默认分支上的 workflow 有效，合并前唯一能验证全流程的就是 PR 运行。
- **完整流程**：
  1. 用 Node 22 与 pnpm 跑仓库三件套（用 `setup-python` 提供 `python` 命令）；
  2. 断言检出是干净的（`git status --porcelain` 为空），保证镜像标签里的 commit 与内容一致；
  3. 用 buildx 构建 `linux/amd64` 镜像（`ubuntu-latest`），并写入 GitHub Actions 的构建缓存；
  4. 对这个镜像运行 `selftest.sh`；
  5. 推送：只在 tag 或手动触发、且四个仓库变量齐全时执行。执行时用 OIDC 取得 AWS 角色，把刚通过自检的同一个镜像打上 `<package.json 版本>-<短 commit>` 标签推送到 ECR，不重新构建。
- **仓库变量**：`AWS_ACCOUNT_ID`、`ECR_REGION`、`ECR_REPOSITORY`、`AWS_ROLE_ARN`。不满足推送条件时，推送这一步照样运行，并在运行摘要里写明"push skipped"及原因（不是发布触发，或缺少哪些变量）。
- **第三方 action**：一律按 commit SHA 钉住。
- **不可覆盖**：由 ECR 的 tag 不可变设置保证；这个设置属于 DevOps，写进部署契约。

### D7 部署契约文档

`docs/deploy.md` 是写给 DevOps 的唯一入口，包括：
- `docker run` 示例：挂载点；容器固定以 uid 10001 运行、宿主挂载目录需对它可写；`/work/repo` 必须是运维方自己 clone 的仓库；要求 IMDSv2 hop limit ≥ 2；
- 环境变量表：分成"写死在镜像里的"和"运行时必须传的"两类；
- 退出码表与产物说明；
- IAM 最小权限清单：Invoke 仅限 `eu.*` 推理配置与 `eu-*` 区域的 foundation model，加 `ListInferenceProfiles` 与 `GetInferenceProfile`；数据必须留在 EU 时，显式 deny `global.*`；
- VPC 端点：`bedrock-runtime`、`bedrock`、SSM；
- 调用日志的敏感性说明；
- 发布门与升级流程。

## Risks / Trade-offs

- **[风险] 提示注入借助 bypass 在容器内执行命令** → 边界放在容器与 VM 层（D3），契约文档把这些条件列为运行前提；输出目录与产物只是数据，不会反向影响宿主机。
- **[风险] 加载探针或隔离验收在带实例角色的宿主上意外调用了真实模型** → D5 固定使用本地 403 端点、假凭证并关闭 IMDS，不依赖"宿主上没有凭证"。
- **[风险] Claude Code 升级后 init 字段名变化（例如 `Task` 改名为 `Agent`）** → 版本钉死；每次升级 Claude Code 都必须重跑自检里的加载探针；检查逻辑同时接受两种工具名，其余字段缺失即判失败，不猜测。
- **[权衡] 结构完整性问题数大于 0 就判失败，首次真实运行可能过严** → 先按严格标准执行，如需放宽以真实运行的证据为依据，不预先放宽。
- **[风险] eu-central-1 上 prompt caching 不可用，成本明显上升** → 摘要给出警告；发布门实测缓存读取 token 并把结果写进记录。
- **[已发生] arm64 在 QEMU 下太慢，自检超时；随后收窄为只构建 amd64** → 第一版 CI 在 x86 runner 上用 QEMU 模拟 arm64：lazy 一步就要 29 秒（原生约 2 秒），加载探针与隔离检查撞上 2 分钟的探针超时。考虑到镜像只为部署到 AWS、EC2 默认是 x86，不再构建 arm64，CI 也不再需要 QEMU 和多架构拼接；推送的就是自检通过的那个镜像。本地仍验证过 arm64 能构建并通过自检，需要 Graviton 时再加原生 arm64 runner。
- **[权衡] 摘要里的花费是 Claude Code 客户端按官方单价的估算，不含 EU 区域的 10% 溢价** → 契约文档注明，实际账单以 AWS 为准。

## Migration Plan

没有数据迁移。发布路径：打 `runner-v*` tag → CI 推送候选镜像 → DevOps 在 VM 上跑发布门（见验收 Oracle 的 R1）→ 通过后在 `docs/deploy.md` 的发布记录里登记为可用。回滚：改用上一个已登记的 tag。

## 验收 Oracle（动手前写死）

合并门（O1–O8），全部通过才能合并：

- **O1 构建**：arm64 在本机构建成功，amd64 经 buildx 构建成功；两种架构的 `selftest.sh` 全部通过；`docker inspect` 的标签等于构建时的 Excavator commit 与 Claude Code 版本。
- **O2 镜像卫生**：在工作区放入诱饵 `.excavator/` 与 `.claude/settings.local.json` 后构建，镜像内不存在它们，也不存在 `~/.aws` 与 `~/.claude/.credentials.json`；默认用户的 uid 为 10001。
- **O3 先验证检查逻辑本身**：用合成的 stream-json 样本做单测。正样本通过；以下每个负样本各自得到规定的退出码：bare 形状的 init、`plugin_errors` 非空、MCP 未连接、少一个 agent、插件路径不对、`is_error`、`permission_denials` 非空、`subagent_stats.failed` 大于 0、模型为 `unknown`、commit 不符、`issues` 非空、contradicted 超阈值、`verification` 为 skipped、参数缺失。解析器必须先证明能区分只差一个字段的样本。
- **O4 真实加载（零凭证）**：在镜像内按 D5 的加载探针启动 full 模式：init 通过全部加载检查，运行以退出码 3 结束，摘要中加载检查为通过。
- **O5 隔离（零凭证）**：对诱饵仓库（带写标记文件的 hook、`.mcp.json` server、同名 skill）按 O4 的方式启动：标记文件不存在，init 中没有诱饵 server 与诱饵 skill。对照组用朴素启动（cwd 在仓库内，不加 `--setting-sources user` 与 `disableAllHooks`），标记文件或诱饵必须出现，以证明这项检查能发现泄漏。诱饵 `CLAUDE.md` 只有模型真正运行时才可能被读到，零凭证下验证不了，放到 R1。
- **O6 lazy 与 MCP**：
  - 在 wcp-auth 的副本上（不动用户语料），镜像内 lazy 的 `factsDigest` 等于镜像外同一 commit 的 lazy 结果；
  - 在镜像内通过 stdio 调用 MCP 七个工具各一次，`project_status` 返回的 `data.projectRoot` 是挂载的仓库。
- **O7 CI**：本地用 actionlint 检查 workflow 通过；PR 上的完整流程（三件套、干净检出断言、amd64 构建与自检）全部通过，推送步骤报告 push skipped 及原因。合并后在 main 上手动触发一次，确认手动触发同样报告 push skipped（缺少 ECR 变量）；这一步只能在合并后做，失败则另起修复 PR。
- **O8 全量门**：三件套全绿，`openspec validate --all --strict` 通过。新文件先 `git add -N` 再跑门。

发布门（R1），不阻塞合并：
- **R1**：DevOps 开通 Bedrock 后，在 VM 上用 ECR 镜像完成两次真实模型运行：
  1. 对 wcp-auth 副本跑 full（模型 `eu.anthropic.claude-sonnet-5`，预算 5 美元）。要求退出码 0；把四类 token、缓存读取是否为 0、估算花费与墙钟时间登记到发布记录。
  2. 对一个带诱饵 `CLAUDE.md` 的小仓库跑 full（预算 1 美元），这个 `CLAUDE.md` 指示写出标记文件。要求标记文件不出现。
- 没有通过 R1 的 tag 不得用于客户仓库。
