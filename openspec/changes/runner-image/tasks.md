执行约束：
- 一 coder（Sonnet）一 acceptor（Opus）；验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 全部工作在 worktree `/Users/57block/Documents/excavator-worktrees/runner-image`（分支 `feat/runner-image`）里进行，只用绝对路径，不动主检出。
- 代码、注释、脚本输出与 `docs/deploy.md` 用英文，OpenSpec 用中文。
- 一组一个 commit，按下列顺序提交；PR 以 merge commit 合入，保留每个 commit。
- 真实语料的源码、路径与输出不提交；wcp-auth 只在副本上跑，不动用户语料现有的 `.excavator/`。
- 发布门 R1 依赖 DevOps 开通 Bedrock，不属于本 change 的任务，在 `docs/deploy.md` 的发布记录里跟踪。

commit 序列：
0. `docs(openspec): propose runner-image`
1. `feat(deploy): add runner image with pinned Claude Code and self-test`
2. `feat(deploy): add run wrapper with load, product and fabrication gates`
3. `ci(deploy): build, self-test and push the runner image`
4. `docs(deploy): add deploy contract for operators`

## 1. 镜像本体

- [x] 1.1 新增 `.dockerignore` 与 `deploy/Dockerfile`，按 design D2 做两阶段构建：`ARG CLAUDE_CODE_VERSION=2.1.281`；`ARG EXCAVATOR_COMMIT` 为空时构建失败；写入 OCI 标签；创建 uid 为 10001 的用户及 `$HOME/.excavator-plugin → /opt/excavator` 软链；设置系统级 `safe.directory=*`；写死 D2 列出的开关类环境变量，并把两个版本号同时写进镜像环境变量，供自检比对。验证：本机 arm64 `docker build` 成功，`docker inspect` 的标签等于传入的 commit 与版本。
- [x] 1.2 新增 `deploy/claude-settings.json`，放到默认用户的 `~/.claude/settings.json`（内容：`skipWebFetchPreflight: true`，`permissions.deny` 禁用 `WebFetch` 与 `WebSearch`）。验证：容器内 `claude --version` 等于钉的版本；`claude doctor` 显示更新已关闭。
- [x] 1.3 新增 `deploy/selftest.sh`：检查两个版本号与镜像环境变量一致、`claude plugin validate /opt/excavator` 通过、`python --version` 可用、`$HOME/.excavator-plugin` 指向检出、系统 git 配置里有 `safe.directory=*`、在临时 git 仓库上跑 lazy 能产出 `knowledge-graph.json`；每项输出 PASS/FAIL，任一 FAIL 以非 0 退出。验证：镜像内自检通过；运行时把期望版本覆盖成错误值，自检必须失败，以证明它能发现不一致。
- [x] 1.4 镜像卫生（O2）：在工作区放诱饵 `.excavator/` 与 `.claude/settings.local.json` 后构建，确认镜像内不存在它们，也不存在 `~/.aws` 与 `~/.claude/.credentials.json`，默认用户 uid 为 10001，`/opt/excavator` 之外没有任何 Excavator 的 skill 或 agent 文件；验证后删除诱饵。验证：检查命令的输出记入任务证据。
- [x] 1.5 用 buildx（QEMU）构建 `linux/amd64`，并在模拟环境里跑 `selftest.sh`（O1）。验证：两种架构的自检都通过。

## 2. 运行脚本与检查

- [x] 2.1 新增 `deploy/run-excavator.mjs` 的参数解析：纯函数，按 design D4 读取 `EXCAVATOR_*` 与 Claude Code 的变量；参数缺失或非法时，在任何写入之前以退出码 2 结束并给出参数名。验证：`tests/deploy/` 单测覆盖 lazy 最小参数、full 缺区域、缺模型、缺预算、预算非数字、模式非法。
- [x] 2.2 stream-json 解析与加载检查：纯函数，输入 init 事件、从 `/opt/excavator/agents/*.md` 读出的期望 agent 集合、期望插件路径，按 D4 输出每项结论。样本放在 `tests/fixtures/deploy/`，取自 2026-09-24 两次探针的实际形状，并做脱敏合成。验证：正样本通过；bare 形状、`plugin_errors` 非空、MCP 未连接、少一个 agent、插件路径不对、没有 `Task`/`Agent` 工具，各自判失败；先用两个只差一个字段的样本证明检查能分辨。
- [x] 2.3 运行、产物与跳过判定：`result` 事件的检查；产物 commit 与模型的检查；跳过规则直接导入 `annotate-graph.mjs` 的 `PIPELINE_VERSION`。验证：单测覆盖 `is_error`、`permission_denials` 非空、`subagent_stats.failed` 大于 0、模型为 `unknown`、commit 不符；"只有 Lazy 产物且 commit 相同"不跳过；"full 产物且 commit 相同"跳过；`EXCAVATOR_FORCE` 强制不跳过。
- [x] 2.4 独立复核与编造判定：以显式的 `--graph`、`--out`、`--report` 调用 `validate-graph.mjs`，统计 `issues`、复核后图里 contradicted 的节点与边、`project.verification === "skipped"`。验证：在合成的小仓库和小图谱上，分别覆盖 contradicted 节点、contradicted 边、跳过核验、`issues` 非空、全部干净五种情况，得到规定的退出码；复核前后 `.excavator/` 下所有文件的哈希不变。
- [x] 2.5 编排：
  - lazy 路径；
  - full 路径按 D3 组装参数：参数组装是纯函数，单测断言参数完全等于 D3 列出的那组、永远不含 `--bare`，并覆盖三种情况——full 产物且 commit 已变时传 `--mode=full`，只有 Lazy 产物或没有产物时传 `--full`，设置 `EXCAVATOR_FORCE` 时传 `--full`；
  - 空目录作为 cwd；
  - 墙钟超时时先发 SIGINT，再发 SIGTERM；
  - 写 `summary.json`；
  - 退出码按 D4 的阶段顺序（配置 → 加载 → 运行 → 产物 → 编造）取第一个失败阶段；配置错误不写任何文件，只输出到标准错误。

  验证：用一个回放录制事件的假 `claude` 可执行文件做端到端测试，覆盖成功（0）、跳过（0）、运行失败（3）、加载失败（4）、编造超阈值（5）；摘要包含 spec 要求的全部字段，缓存读取为 0 时有警告。注意：假 `claude` 只证明接线正确，不证明真实模型可用。
- [x] 2.6 加载探针（O4）：`selftest.sh` 增加一步——按 D5 固定使用本地 403 端点、假凭证并关闭 IMDS，以 full 模式启动运行脚本，要求加载检查通过、运行以 3 结束。验证：镜像内自检通过；403 端点记录到至少一次请求，并且没有向任何外部地址发出模型请求；把镜像里某个 agent 文件 frontmatter 的 `name:` 改成与文件名不一致后重跑，自检必须失败。直接删文件测不出问题：期望集合与 Claude Code 实际加载的集合都从同一目录读取，两边会同时少一个；另外，期望集合为空时检查本身必须判失败。
- [x] 2.7 隔离（O5）：`selftest.sh` 增加诱饵仓库一步（带写标记文件的 hook、`.mcp.json` server、同名 skill），按 2.6 的方式启动。验证：标记文件不存在，init 里没有诱饵 server 与诱饵 skill，已加载插件的路径为 `/opt/excavator`；对照组用朴素启动（cwd 在仓库内，不加 `--setting-sources user` 与 `disableAllHooks`），标记文件或诱饵必须出现，以证明这个检查能发现泄漏。诱饵 `CLAUDE.md` 放到发布门 R1 用真实模型验证。
- [x] 2.8 lazy 与 MCP（O6）：新增 `deploy/mcp-smoke.mjs`，通过 stdio 对给定根目录调用 MCP 七个工具各一次（`semantic_commit` 用 `semantic_plan` 返回的哈希，提交一条标为 smoke 的摘要，只作用于一次性副本），并断言 `project_status` 的 `data.projectRoot`；`selftest.sh` 在临时仓库上调用它。验证：自检通过；在 wcp-auth 副本上，镜像内 lazy 的 `factsDigest` 等于镜像外同一 commit 的结果，镜像内 `mcp-smoke` 七个工具全部成功；只在任务证据里记录脱敏的计数。

## 3. CI

- [ ] 3.1 新增 `.github/workflows/runner-image.yml`，按 design D6：
  - 触发条件：`runner-v*` tag、手动触发、改到 `deploy/**` 等路径的 PR；
  - 三件套使用 Node 22、pnpm 与 `setup-python`；
  - QEMU + buildx 构建两种架构，每种架构都跑 `selftest.sh`；
  - 用 OIDC 推送 `<package.json 版本>-<短 commit>` 标签；
  - 第三方 action 按 commit SHA 钉住。

  验证：本地解析 YAML 无误；PR 上的 workflow 通过。
- [ ] 3.2 推送前检查四个仓库变量：缺任何一个就跳过推送，并在运行摘要里写 "push skipped"；自检失败时不推送。验证：没有 ECR 变量时手动触发完整流程，两种架构的构建与自检都通过，摘要显示 push skipped（O7）。

## 4. 部署契约文档

- [ ] 4.1 新增 `docs/deploy.md`，按 design D7 写：`docker run` 示例、两类环境变量表、退出码表、产物说明、IAM 与 VPC 端点清单、安全前提、发布门 R1 与升级流程，以及一张空的发布记录表。验证：新增单测，断言运行脚本导出的运行时参数名集合与文档里运行时参数表的集合完全相同，任何一边多出或缺少都失败；先把文档里一个参数名故意改错，确认单测会失败。

## 5. 验收（acceptor 亲自执行，不采信 coder 自报）

- [ ] 5.1 全量门（O8）：在干净检出上运行 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test` 与 `openspec validate --all --strict`；新文件先 `git add -N` 再跑。
- [ ] 5.2 亲自重跑 O1–O7：两种架构构建与自检、镜像卫生、诱饵隔离及其对照、零凭证加载探针及删掉 agent 的反例、wcp-auth 副本上的 lazy 一致性与 MCP 七个工具、CI 的 push skipped。
- [ ] 5.3 PR 描述写明镜像大小、两种架构的自检结果、构建阶段需要编译工具链的原因、wcp-auth 的脱敏计数；不含真实路径与产物。
- [ ] 5.4 PR 以 merge commit 合入 `main`，保留 commit 序列 0–4。
