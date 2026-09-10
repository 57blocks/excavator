# Excavator v2：以 Understand-Anything 为基座重建（供另一个会话执行）

planner 定稿 2026-09-10 18:40。执行顺序由用户定：**① 改名 → ② 陈述可核验 → ③ 支持 cebreo → ④ MCP**。新分支、全新开始。

**修订 2026-09-10（v2 会话，三份只读盘点核验后）**：分支名 `excavator-v2`，建在 worktree（§1）；**零兼容**——不保留 UA 的 `.understand-anything`/旧名兼容分支，不沿用旧 excavator 的 MCP 契约与 PRD skill，MCP 与 PRD 消费端全新设计（§5）；数据目录 `.excavator/`。各节【修正】段为本次修订，其余保持原文。

## 0. 背景、约束与已量到的事实

**用户决策**：基于 UA 开发 excavator；clone UA 后改造；不再维护旧 excavator 内核（旧 main 只作资产来源）。
**不变的约束**：结果可辩护、可审计、零编造（覆盖缺口可见即可接受，编造零容忍）；越简单越好但能扩展；无 fork 上游同步、不给上游提 PR（我们是独立衍生品，MIT 允许，保留版权声明）。
**评判优先级**：AI 能否完整了解一个流程 > 零编造 > 锚点 > 召回数量。
**语料（用户 2026-09-10）**：**只有 wcp 与 cebreo**。koel / ombi / tolgee / answer 全部退出验收，其真值只作格式参考。wcp = `/Users/57block/Documents/excavator-test-repos/wcp/`，父目录不是 git 仓库，五个子仓各自是（wcp-ui 895dad43、wcp-service-v2 51cb436a、wcp-service efb884f、wcp-auth 76e958d、wcp_review_service 272bbe7），UA 记为 `multi-repo:<digest>`。wcp 已有完整 UA 产物 `wcp/.ua/`（knowledge-graph 10.2MB、domain-graph 112KB、fingerprints 3.9MB、meta、config、`.understandignore`、`intermediate/`、三个 `.trash-*`）；产物内容里目录名只出现在一个自引用节点 `config:.ua/config.json`（UA 把自己的配置文件扫进了清单），其余路径全是相对子仓路径，所以**改文件夹名即可复用**：`.ua/` → `.excavator/`，`.understandignore` → `.excavatorignore`，删 `.trash-*`，该自引用节点由 §2 的默认忽略在下一次增量时清掉。改名前把原 `.ua/` 整体拷一份到 `excavator-eval/tools/understand-anything/wcp-quality/baseline-ua/` 作 UA 基线（clean-room 里已有 graph 两个文件的副本，这里存全套）。

**UA 是什么**：不是 CLI，是 agent 插件。9 个 skill + 10 个 agent 定义 + 确定性脚本（scan-project / extract-import-map / compute-batches / extract-structure，tree-sitter WASM，14 语言）+ Python 合并脚本 + React dashboard/viewer。模型那一半由宿主 agent 执行，没有自有模型客户端、没有 key。源码：`/Users/57block/Documents/excavator-eval/tools/understand-anything/src` @ `5feed1f2`（2026-09-08，v2.9.6，MIT）。调查全文：`tools/understand-anything/NOTES.md`。

**已量到的事实（决定设计的）**

| 事实 | 数字 | 出处 |
|---|---|---|
| 确定性抽取记录全部带行号 | koel 3,912 函数 / 1,253 类 / 23,773 调用点，0 条缺行号 | NOTES 无模型全量 |
| 发布图的边没有锚点和来源字段 | `GraphEdge={source,target,type,direction,description?,weight}` | `packages/core/src/types.ts` |
| 发布图 98.8% 的边是确定性种类，却由模型转写 | wcp 24,460 条边中 imports 13,474 + contains 5,627 + exports 4,335 + calls 739 | wcp `.ua/knowledge-graph.json` |
| 判断类边编造率 | 样本图 6/10 判断类边无源码依据；总体 3.3% | NOTES 十条审计 |
| Go 方法身份坍缩 | wcp 3,497 个声明只有 2,825 个可寻址节点，19% 因同文件同名（TableName×23、Consume/Cancel/Reject 多接收者）合并；739 条 calls 中 12 条因此在发布锚点处不成立 | wcp-quality/scripts/collapse.out.txt、verify_calls.out.txt |
| 同一次运行内认识等级漂移 | Vue 文件三种处理（读全文 / 按文件名猜 / 加脚本看不见的边）无字段区分；calls 边逐批人工筛选无丢弃记录 | plugin-run/logs/batch-agent-notes.md |
| 覆盖率自证完整 | 跳过文件不进分母，koel 346 个 .vue 0 记录而 Structure coverage = 1.0 | `scripts/lib/large-repo-benchmark.mjs:1487` |
| 新鲜度自我盖章 | cosmetic 变更保留旧摘要并把 `gitCommitHash` 推进到新提交 | `skills/understand/finalize-incremental.mjs:408-422` |
| 领域视图的锚点其实不差 | wcp 6 领域 / 19 流程 / 121 步骤，119 步有 filePath、116 步有 lineRange，但多为整组件跨度（如 `ApplyLeave.tsx [68,873]`） | wcp `.ua/domain-graph.json` |
| 成本与时间 | 每批约 25 文件 11–21 万 token、5–13 分钟；wcp 全量 `/understand` 65 分钟 + `/understand-domain` 60 分钟 | plugin-run/logs/per-batch-cost.tsv、wcp `.ua` 时间戳 |

**旧 excavator 可搬的资产**（都在 `/Users/57block/Documents/excavator` main，按需按路径复制，不整仓迁移）：`packages/compiler/adapters/rules/**`（【修正】**100 条** ast-grep YAML 规则 + 100 个 `__tests__/*-test.yml` fixture + 1 个 sgconfig，共 201 个 yml；覆盖 aspnet 路由/authorize、efcore 表、angular http/form/snackbar、axios/ky、gin、spring、laravel、casbin 等；规则 metadata 用 `emit`/`fields`/`required`/`compose` 声明产出种类与锚点，加载器 `adapters/packs/{load,spec}.ts`）；XAML 视图 reader（`adapters/languages/xaml/{structure,structural}.ts` + `knowledge/resolve-view-links.ts`，约 300 行，作参考）；`eval/truth-score.ts` + `eval/truth-score/*`（评分**语义**可搬，代码对 v2 图重写，见 §4）。**只作参考、不移植**（零兼容）：`packages/mcp-contract`（10 工具）与 `packages/mcp-server`（67 文件 6,797 行）；`skills/prd-from-code`（21 文件约 6,900 行）**弃用**，第 ④ 步新写薄 skill。评测真值：`/Users/57block/Documents/excavator-eval/corpus/{answer,ombi,tolgee-platform,koel}/truth/*.json`（4 系统 12 流程 482 记录 620 锚点；**无 wcp、无 cebreo**），评分约定 `corpus/TRUTH-INDEX.md`、`/Users/57block/Documents/excavator-eval/criteria.md`（在 eval 根，不在 corpus 下）。

## 1. 仓库与分支（第 0 步，半天）

【修正】原方案在主 checkout 上 `git checkout --orphan` + `git rm -rf .` + `git clean -fdx -e .claude` 会造成三处实际损失：`.claude/agents/*.md`、`.claude/settings.json`、`.claude/skills/*` 是**被跟踪文件**，`git rm` 会删掉（`-e .claude` 只保护未跟踪项）；`.excavator/epochs` 是**被忽略文件**，`-x` 会删掉，而它正是旧 MCP `excavator-wcp` 在服务的 store（`~/.claude.json` 里的客户端配置指向主 checkout 的 `packages/mcp-server/cli.ts` 与该 store）。改为**孤儿分支 + worktree**：主 checkout 留在 `main` 不动，旧 MCP、旧 skill、旧 agent 定义继续可用；第 ④ 步落地后再把客户端配置指到新路径。仍是同一仓库、同一 remote，PR 与 Linear 流程不变。

```bash
# 本机 git 2.32 无 `worktree add --orphan`（需 2.42），用 detach 再 orphan：
V2=/Users/57block/Documents/excavator-wt/excavator-v2
git -C /Users/57block/Documents/excavator worktree add --detach "$V2" main
git -C "$V2" checkout --orphan excavator-v2 && git -C "$V2" rm -rf -q . && git -C "$V2" clean -fdxq
git -C "$V2" commit --allow-empty -m "chore: root of excavator-v2" && git -C "$V2" push -u origin excavator-v2
#   空根提交让第一份导入也能走 PR 评审；之后每步在 v2/<step>-<slug> 分支上做，PR 对 excavator-v2
git -C "$V2" checkout -b v2/step0-import
UA=/Users/57block/Documents/excavator-eval/tools/understand-anything/src
# 从钉死的提交导入，不用工作树：UA 检出里 understand-anything-plugin/pnpm-lock.yaml 有未提交修改
git -C "$UA" archive 5feed1f2 understand-anything-plugin | tar -x -C "$V2" --strip-components=1
git -C "$UA" archive 5feed1f2 tests scripts vitest.config.ts | tar -x -C "$V2"
```

**为什么还要搬外层 `tests/`、`scripts/`、`vitest.config.ts`**：plugin 目录自己的 `vitest.config.ts` 故意解析到零个测试（遮蔽外层聚合配置），skill 测试在外层 `tests/skill`，`large-repo-benchmark.mjs` 在外层 `scripts/lib`；只导入 plugin 目录，`pnpm test` 的「绿」是空绿，装置无效。扁平化后：外层 `vitest.config.ts` 作根配置并修路径，根 `package.json` 合并外层 `build/test/lint` 脚本与 plugin 的 manifest，pnpm workspace 只留 `packages/*`。

保留：`packages/core`、`packages/dashboard`、`packages/viewer`、`packages/tree-sitter-{dart,swift}-wasm`（仅这两个 vendored wasm）、`skills/`（9 个）、`agents/`（10 个）、`hooks/`（3 个文件）、`src/`、`.claude-plugin/plugin.json`、外层 `tests/`、`scripts/lib/`。
不导入：`homepage/`、`READMEs/`、`docs/`、`.copilot-plugin`、`.cursor-plugin`、`install.sh`/`install.ps1`、`.github/`、`assets/`——这些都在 UA 外层根目录，plugin 目录本就没有，`git archive <subdir>` 天然不含。Figma skill 保留但在改名验收范围之外。
从旧 main 带过来（`git -C "$V2" checkout main -- <path>` 后按需改）：`.claude/agents/{planner,coder,reviewer}.md`（reviewer 的 `model: fable` 改 `opus`）、`.claude/settings.json`（typecheck hook 的 `npm run typecheck` 改为 v2 根 `pnpm typecheck`，没有就新增该脚本；拦截 push 到 main 的 PreToolUse hook 保留）。**不带**：openspec skills、`prd-from-code`、`AGENTS.md`、`openspec/`、`docs/`。
新增：`NOTICE`（"Derived from Understand-Anything 5feed1f2, © 2026 Yuxiang Lin, Infinite Universe, Inc., MIT"，版权行以 UA `LICENSE` 实际文字为准）；`LICENSE` 用 UA 原文替换旧仓的 "Excavator contributors" 版；新的短 `CLAUDE.md`/`AGENTS.md`（见 §7），旧 AGENTS.md 的强约束不带过来。

**先验装置（动手前先量 oracle）**：先在 `$UA/understand-anything-plugin` 与 `$UA` 根各跑一次 `pnpm test`（那里依赖已装、`packages/core/dist` 已 build），记下测试文件数与用例数。导入提交上 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test` 必须绿，且用例数 **= oracle**；少一条即装置失效，不得合入。
工具链：Node ≥ 22（本机 22.16.0）；pnpm 按 UA `packageManager` 钉的 **10.6.2**（本机 10.12.2 + corepack 0.32 可自动切换）——导入提交不改版本号，装置绿之后再议升级。测试框架是 **vitest**（不是旧仓的 node:test）。

首个 PR 对 `excavator-v2`，**三个提交、逐步可 revert**：
1. `chore: import Understand-Anything understand-anything-plugin @ 5feed1f2 (MIT)`——只解 plugin 子目录，**零编辑**，`diff -r` 与 archive 提取物完全一致；
2. `chore: flatten workspace so root pnpm test runs the imported suites`——搬入外层 `tests/`、`scripts/`、外层 `vitest.config.ts`（替换 plugin 那份零测试配置），修相对路径，根 `package.json` 合并外层 `build/test/lint` 脚本与所需 devDependencies，重生 lock 后 `--frozen-lockfile` 必须通过；用例数 = oracle；
3. `chore: repo skeleton`——`.claude/agents`（reviewer→opus）、`.claude/settings.json`（hook 改 pnpm）、`openspec init --tools claude,codex`（由它生成 openspec skills 与 `openspec/`，再写短 `config.yaml`）、`NOTICE`、`LICENSE`、短 `CLAUDE.md`/`AGENTS.md`、`.gitignore`（`.excavator/`）、本 plan 复制为 `docs/v2-plan.md`（**此后 plan 以仓内副本为准，改 plan 也走 commit**）。
第 0 步是 chore，不建 openspec change；第 ①–④ 步每步一个 openspec change（propose → 自审 → apply → archive）+ 一个 PR。
分工：Sonnet coder；Opus 验收——独立复测 oracle、`diff -r` 核对导入提交、跑三件套、核对 LICENSE/NOTICE 文字对 UA 原文、`gh pr merge --merge`。

## 2. 第 ① 步：改名为 excavator（1 天，Sonnet 可做，Opus 验收）

**改名范围**（一次性、全仓）：

| 项 | 从 | 到 |
|---|---|---|
| 插件 | `understand-anything`（`.claude-plugin/plugin.json`、`package.json`、`@understand-anything/*`） | `excavator`、`@excavator/*` |
| skill 名 | `/understand`、`/understand-chat`、`-diff`、`-explain`、`-onboard`、`-domain`、`-knowledge`、`-dashboard`、`-figma` | `/excavator`、`/excavator-chat`、`-diff`、`-explain`、`-onboard`、`-domain`、`-knowledge`、`-dashboard`、`-figma` |
| agent 名 | `file-analyzer` 等 10 个 | `excavator-file-analyzer` 等（避免与用户机器上残留的 UA 安装冲突；SKILL.md 内引用同步改） |
| 数据目录 | `.ua/`，兼容 `.understand-anything/` | `.excavator/`，**删除全部 11 处兼容分支**：`packages/core/src/persistence/index.ts:7-21`（`UA_DIR`/`LEGACY_UA_DIR`/`resolveUaDirName`）、`hooks/post-tool-use-auto-update.mjs:6`、`hooks/hooks.json:19`、`skills/understand-figma/{figma-scan,figma-merge}.mjs:8`、`skills/understand-knowledge/parse-knowledge-base.py:28`、`skills/understand-knowledge/merge-knowledge-graph.py:31`、`packages/dashboard/vite.config.ts:23`、`packages/viewer/bin/viewer.mjs:32`、`skills/understand/prepare-incremental.mjs:64`、`skills/understand/SKILL.md:126`。目录名单一来源（persistence 常量 `EXCAVATOR_DIR = ".excavator"`），shell/Python 处硬编码同一字面量并由 grep 门守住。选 `.excavator` 不用缩写：与插件名、旧仓 store 目录一致，grep 无歧义，路径几乎只被脚本使用 |
| shell 变量/文件 | 【修正】`UA_DIR` **不是环境变量**——代码里没有 `process.env.UA_DIR`，它是 21 个文件里各自内联计算的 shell 局部变量；`.understandignore`；`$HOME/.understand-anything-plugin` 是**插件安装路径搜索**（`skills/understand/SKILL.md:89-112`、`understand-dashboard/SKILL.md:73-95`、`understand-domain/SKILL.md:64-87`、`hooks/auto-update-prompt.md:17`），与数据目录兼容是两回事 | 每站点改为固定 `.excavator`（不再判定目录是否存在）；`.excavatorignore`；安装路径优先用 `${CLAUDE_PLUGIN_ROOT}`，回退搜索改 `$HOME/.excavator-plugin` |
| hooks | `hooks/hooks.json`、`post-tool-use-auto-update.mjs`、`auto-update-prompt.md` 中的文案与路径 | 同步；并**去掉「Do not ask the user for confirmation — just do it」**，改为只提示不执行 |
| dashboard/viewer | 标题、i18n 六种语言文案、`packages/viewer/README.md` | excavator |
| 默认忽略 | 不排除 agent 目录 | `.excavatorignore` 默认排除 `.claude/ .agents/ .codex/ .excavator/ .ua/ .understand-anything/`（实测 80 个插件文件混进过清单） |

**改名足迹**（盘点实测）：107 个文件——packages 59、skills 25、src 10、agents 7、hooks 3、根 3（`package.json`、`pnpm-lock.yaml`、`.claude-plugin/plugin.json`）。改名是**内部所有名称**（skill 名、agent 名、包名、i18n 文案、数据目录、shell 变量、注释）一起改，不只是目录名；引用关系必须自洽（用户 2026-09-10 强调）。

**验收**：
1. `grep -rniE 'understand-anything|understandignore|UA_DIR|\.ua\b' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .` 只命中 `NOTICE`（plugin 目录没有 CHANGELOG）。
2. **引用完整性脚本**（新 `scripts/check-refs.mjs`，进 `pnpm test`）：`.claude-plugin/plugin.json` 列出的每个 skill/agent 在 `skills/`、`agents/` 下有同名目录/文件；每个 `SKILL.md` frontmatter `name:` 与目录名一致；SKILL.md 与 agents/*.md 里点名的 agent（`subagent_type`、"use the X agent"）在 `agents/` 下存在；`hooks/hooks.json` 与各 SKILL.md 引用的 `.mjs/.py` 路径存在；dashboard i18n 六种语言的 key 集合相等。**先验装置**：先故意改坏一条引用（如把一个 agent 文件改名），脚本必须红，再恢复。
3. `pnpm test` 全绿且用例数 ≥ 导入提交的 oracle。
4. **wcp 复用**：按 §0 把 `wcp/.ua/` 改名为 `wcp/.excavator/`（先拷基线），然后 `/excavator-dashboard` 能打开它、`/excavator-diff` 或 hooks 的增量路径能识别它并只报少量变更（自引用节点被默认忽略清掉算预期变更）；不在第 ① 步跑 wcp 全量模型阶段。
5. **确定性阶段冒烟**：对 wcp 与 cebreo 各跑一次 scan → import-map → batches → extract-structure（无模型，秒级），产物落在 `.excavator/intermediate/`；两个目标里**不出现** `.ua/`，各子仓 `git status` 只多 `.excavator/`（cebreo 非 git，看目录）。cebreo 这一跑同时给 §4.1 的普查表，不必再跑一次。

**§2 落地记录（2026-09-10，PR `v2/step1-rename` → `excavator-v2`，openspec change `excavator-rename`，commit 1-7）**：

- 命名表（第 74-81 行）已按 `openspec/changes/excavator-rename/design.md` D1 逐项落地：插件/包/skill/agent 全部改名（commit 1-2）；skill 目录名与 `name:` frontmatter、agent 文件名与 `name:` frontmatter 一一对应，由 `scripts/check-refs.mjs`（commit 6）机械核对。
- 第 77 行列出的 11 处数据目录回退分支（`.ua`/`.understand-anything` 二选一探测）已**全部删除**（commit 3），另发现并一并删除了 3 处该清单未覆盖到的站点（`scripts/generate-large-graph.mjs`、`hooks/post-tool-use-auto-update.mjs` 里第二处、以及各 SKILL.md/agents/*.md 内联复制的同款三元式，逐文件数超过原盘点的 21 处，因为 21 是"文件数"不是"分支数"，同一文件常有多处内联三元式）。`packages/core/src/persistence/index.ts` 现只导出 `EXCAVATOR_DIR = ".excavator"` 常量与 `resolveDataDir()`，不再探测任何遗留目录。
- 第 78 行【修正】的 `UA_DIR` 非环境变量的结论已落地为代码：21+ 个内联三元式全部折叠为固定 `.excavator`（或对应的 `$DATA_DIR="$PROJECT_ROOT/.excavator"` 局部变量），`UA_DIR` 这个 shell 变量名在仓库里不再出现；插件安装路径搜索（原 `$HOME/.understand-anything-plugin`）改为 `$HOME/.excavator-plugin`，候选列表从 8 项砍到 `${CLAUDE_PLUGIN_ROOT}` → `$HOME/.excavator-plugin` → `$SELF_RELATIVE` 三项（commit 4，design D5）。
- **Claude Code 前缀调用形式**（design D11）：Claude Code 里实际调用是 `/excavator:excavator`、`/excavator:excavator-chat` 等带插件名前缀的形式；仓库内 SKILL.md/agents/hooks 的散文统一写宿主中立的裸名（`/excavator`），前缀说明放在 README 的 Claude Code 安装小节。`scripts/check-refs.mjs` 的斜杠引用检查两种形式都接受。
- 两宿主收敛（design D6）：新 `install.sh` 只做 Codex（符号链接 `~/.agents/skills/<skill>` + `~/.excavator-plugin`，支持 `--uninstall`）；`install.ps1` 已删除；Claude Code 走 `.claude-plugin/marketplace.json`（commit 4）。
- hooks 只建议不执行（design D7）：`hooks.json`/`auto-update-prompt.md`/`post-tool-use-auto-update.mjs` 里的「Do not ask the user for confirmation — just do it」已删除，SessionStart 与 PostToolUse 两条路径现在都是"检测变化→提议→等待用户"（commit 5）。
- 第 81 行的默认忽略已落地为 `DEFAULT_IGNORE_PATTERNS` 新增 `.claude/ .agents/ .codex/ .excavator/`（`.ua/`、`.understand-anything/` 不再需要，因为不再是被识别的数据目录名，见上一条）；`scan-project.mjs` 的 walker 自排除表 `HARD_SKIP_DIRS` 已同步并由单元测试断言是 `DEFAULT_IGNORE_PATTERNS` 的子集（commit 3，design D4）。
- 验收第 1 条的 grep 命令已复测：`.excavator-report-*`、`EXCAVATOR_NO_WORKTREE_REDIRECT`、`EXCAVATOR_FIGMA_FORCE`、`docs/EXCAVATOR_ONBOARDING.md` 等原盘点未列出的 `UA_`/`UNDERSTAND_` 前缀内部标识符也一并改名，全仓库只剩 `NOTICE`、`docs/`、`openspec/` 里的历史性提及，以及 `scripts/lib/large-repo-benchmark.mjs` 一处刻意保留指向上游 schema 文件的 URL（该 schema 文件本身在 `docs/` 范围外未改名，两端必须字节一致）。
- 验收第 2 条的引用完整性脚本已实现为 `scripts/check-refs.mjs`（六项检查，见 commit 6 message），先验装置证明改坏一个 agent 文件会被同时两种检查方式抓到。
- 详细的逐 commit 验证结果、oracle 逐行复测、残余 `understand` 分类见 PR 描述。

## 3. 第 ② 步：陈述可核验（核心，1–2 周）

**架构（用户 2026-09-11 两次收敛后的定稿）**：UA 的流水线**原样保留**——图的作者仍是模型（file-analyzer），id 格式、合并去重、增量分类、抽取器行为一律不动。excavator 只作**补充层**，两个口：
1. **插件口**：能注册进 `PluginRegistry` 的（新语言抽取器、新解析器）走 UA 既有的注册点。
2. **后阶段口**：其余一律是合并之后的附加阶段，只**加**字段 / 加计数 / 加标记过的边，不删不改模型写的任何东西。

判据一句话：**UA 今天的产物，经过任一新增阶段后仍原样通过**。往 UA 文件里加内容可以（新阶段小节、新输出字段、新注册行）；改已有输出的样子不行。

**3.1 Schema（已落地）**：边 `evidence?`/`provenance?`/`verification?`/`addedBy?`；节点 `owner?`/`owners?`/`anchorSource?`/`verification?`；根 `coverage?`/`gaps?`；`project` 增 `sourceDigest?`/`factsDigest?`/`pipelineVersion?`/`model?`，`gitCommitHash: string|null`。**全部可选**，边与根 `.passthrough()`。强制锚点与证据纪律**不进** `validateGraph`（那会拒掉 UA 今天的产物），而是导出的纯函数 `auditGraphShape(graph)` 报告 6 类 code。`weight` 保留为种类常量。

**3.2 覆盖账本（已落地）**：`scan-project.mjs` 增 `skipped[{path,reason,language}]`（symlink / read-failed / unknown-language / binary / too-large / ignored）与 `coverage.limits`；`extract-structure` 每文件 `status`（parsed / zero-symbol / no-extractor / parse-failed）且失败文件保留在 `results`；`extract-import-map` 增 `unresolved`；`coverage-ledger.mjs` 纯折叠 + `conservationViolations()`。守恒式：`files = parsed + zeroSymbol + Σ skipped[reason]`（两个抽取结局也进 `skipped` 这张表，否则 html 那类语言的等式不成立）。

**3.3 结构全量抽取（新增阶段 1.2）**：`structure-all.mjs` 对**全部**扫描文件调用**未修改的** `extract-structure.mjs`（分块、逐字节确定），产 `intermediate/structure-all.json`：每文件一行，带 `status`、声明行区间、imports/exports 行号、调用点。全部文件而非只 code 文件，否则账本守恒与「html/xaml 可见为 no-extractor」都测不出来。

**3.4 annotate-graph（新增阶段 2.3，merge 之后）**：读模型写的图 + 3.3 的事实，
- 每条边给 `provenance`：能在事实里找到对应记录 → `extracted` + `evidence[{file,line,source}]`；找不到 → `inferred`，按类型计 `edge-auto-inferred`。模型自报的 evidence 一致 → 该条 `verified:true`；不一致 → **保留模型原文**、追加抽取行，同时计 `evidence-corrected` 与 `edge-contradicted`。
- 审计计数全部进 `gaps`（带样本）：`edge-missing`（按类型）、`edge-unsupported`、`node-missing`、`node-unsupported`、`identity-collision`、`shape-issue`、`calls-ambiguous`、`calls-unresolved`。比对只在**读得懂的文件**上做（`parsed`/`zero-symbol`）——html 里的节点是「没有读者」，不是「模型编的」。
- 节点加 `owner`/`owners`/`anchorSource`；同文件同名多声明被合成一个节点时记 `owners` 与 `identity-collision`，**id 不改**（wcp 的 3,497→2,825 由此可见而不被「修正」）。
- 根加 `coverage`/`gaps` 与 `project.sourceDigest`/`factsDigest`/`pipelineVersion`。
- 默认补边：只补模型漏掉的 `imports`/`exports`/`contains`，标 `addedBy:'excavator-annotate'`，`--no-supplement` 可关；**`calls` 永不补**，留缺口。补边只在两端节点都已存在时进行——造节点就等于当作者。
- 输出 `annotated-graph.json` + `audit.json`，同输入两次运行逐字节相同。

**3.5 触源码的验证器（新增阶段 6b）**：`validate-graph.mjs`——UA 的阶段 6 inline validator **保留**，这一阶段在它之后开源码文件核对：function/class 节点锚点行 ±1 含 `name`；`extracted` 边证据行含按类型的记号；`inferred` 边直接通过；沿用 inline validator 的全部引用完整性检查；`step` 节点须有可解析的 `nodeIds` 或标 `inferred`。产 `validation.json` + `validated-graph.json`（标 `verification:'contradicted'`、计数并入 gaps）。读不到的源码文件计 `source-missing`，**不当作矛盾**。**先验装置**是合入门槛：注入一条证据行不含 callee 的边与一个偏移 5 行的节点 → 各恰好 1；干净夹具 0/0。

**3.6 基准分母**：`structureCoverage` 分母 = parsed + zeroSymbol + skipped，并新增 `structureSkipped`。分母诚实后覆盖率对含无读者语言的项目必然 < 1，所以它**不再是成功门**——门是 `structureFailures`（读者跑了但失败）。

**3.7 ②b（分支 `v2/step2b-verify`，已落地）**——模型那一半，五个 commit：

- **提示词只加节**（`agents/` 两个文件末尾追加，既有段落零删改，用「基线分支的副本必须是工作副本的字节前缀」这个结构性断言守住）：file-analyzer 的「证据字段」要求每条边带 `evidence:[{file,line,source:'model'}]`，行号**抄自**结构 JSON 的具体字段（`startLine`/`exports[].line`/`callGraph[].lineNumber`/`imports[].line`），抄不到就标 `provenance:'inferred'` 且不写 evidence；**禁止自行写 `extracted`**（那是 2.3 才能确立的事，写了就会被计为 `edge-unsupported`）；`status: no-extractor|parse-failed` 的文件仍**只**建一个 file 节点，不臆造成员、不写 calls 边，而既有的 `batchImportData` 1:1 imports 规则明文保留；结构 JSON 给了 `owner` 就原样抄、没给不猜、id 不因 owner 改变。「框架指引」是个钩子：检测到的框架若有 `skills/excavator/frameworks/<id>.md` 就先读，没有就**静默继续**——缺文件是「还没人写下来」，不是「可以自己回忆」；约定只指路不产行号，纯靠约定推出的边仍是 `inferred`。domain-analyzer 追加一句 step `nodeIds`。
- **summary 核验（新增阶段 2.5，可 `--no-verify`/`--verify-sample <n>`）**：`agents/excavator-summary-verifier.md` 只拿到 `{id,filePath,lineRange,summary}` 与源码切片——**故意不给图、不给标签、不给项目描述**，因为「在全图语境下看起来合理」正是这一遍要抓的东西；三态且没有第四态，`verified`/`unverified` 之间犯不准就选 `unverified`。`apply-verification.mjs` 三个动作：`prepare`（挑可核的、按 id 排序后**定步长**抽样而非取前 n、锚点路径越出项目根一律拒绝并计数——批次是交给模型的读取指令）、`apply`（写 `verification`，**从不动 summary**；contradicted 连理由存 `intermediate/contradicted-summaries.json` 并计 `summary-contradicted`；`project.verification = full|sample:<n>|skipped` 取自 manifest 而非旗标）、`skip`（`--no-verify` 时把「一条都没核」明说出来）。守恒：每条非空 summary 落 verified/unverified/contradicted/dirty/未标记之一，桶和必须等于非空 summary 数。
- **新鲜度可见性**：`verification` 的四态与合并规则收进 `verification-state.mjs`（`contradicted > dirty > unverified > verified`，后写者**永不降级**前一阶段的标记，否则一句 `verified` 就抹掉了 dirty）。annotate 从**增量计划**（流水线自己记下的「这次跳过了什么」）取 cosmetic 文件，给其节点标 `verification:'dirty'`，并把清单读-改-写进 `meta.json` 的 `excavator.dirtyFiles`。不用「拿 fingerprints 现算」是因为全量分析本来就重推了每个节点，那样算会把刚做完的工作标成过期。UA 的 commit 标记逻辑一字不动，且双向证明：`finalize-incremental.mjs` 与基线分支逐字节相同，且真跑一次 cosmetic SKIP 看到标记照旧前进、`meta.excavator` 照旧被 `{...previous}` 带过去。
- **非 git 目标**：`prepare-incremental.mjs` 新增回退分支，只补 git 本来回答的四件事——commit 为 null、跳过工作树检查、变更集取 fingerprints 的 contentHash 差异、「这文件算不算项目的」由文件系统而不是索引回答（那条安全检查因此保住牙齿）。两处都 fail-closed：读不出的文件算变了，没有基线指纹的文件算变了。`build-fingerprints.mjs` 接受 `gitCommitHash: null`（且只接受 null，`undefined` 仍拒——模板没替换成功不能冒充「没有 commit」），否则非 git 项目永远拿不到基线、上面的回退在真实场景里不可达。annotate 另把 `project.gitCommitHash` 归一：**带标识符的一律保留**（判据是「有没有 ≥7 位的十六进制串」这个结构性测试，因此 git commit、缩写 commit、流水线自己写的 `multi-repo:<digest>` 都留着——把 multi-repo 标记清成 null 等于扔掉「这图是按哪些成员仓状态建的」这唯一记录，也等于改写流水线自己写的值）；不带标识符的（`""`/空白/`"unknown"`/`"HEAD"`/`"none"`/缺字段）为 `null`，并计数 + 把被替换的原值作为样本进 `git-commit-hash-normalized`，`sourceDigest` 承担版本；scan 没有 `contentDigest` 时报 `source-digest-missing` 而不是让缺失自己被发现。
- **领域步骤（新增阶段 4.5）**：`annotate-domain.mjs` 把模型给的 `nodeIds` **逐个核对**，解析不到的挪进 `unresolvedNodeIds` 并计 `step-nodeid-unresolved`（假 id 留在 `nodeIds` 里比缺它更坏——它看着像锚点却答不了任何问题）；没给的按 filePath + lineRange 交集推导，只匹配到文件节点时单独计 `step-file-anchored`（「在这个文件某处」是更弱的断言）；evidence 只在匹配到的节点真有行号时写，否则计 `step-evidence-unavailable`——`line: 1` 会让后面的检查去「确认」一句没人说过的话。`step-unanchored` **不在这里写**：锚定就是它的活，自己给自己判分会双计。
- **dashboard 与 `project.model`**：`displaySummary()` 让空 summary 显示节点名（不是「No summary available」这类看起来像描述的占位话），并用 dashboard 自己的加载路径（`validateGraph`）钉住新字段一个不丢；`project.model` 取 `--model` 或宿主环境变量，取不到就是 `unknown`——`unknown` 是真答案，编一个名字会让图对自己的作者身份也不可反驳。

**3.8 ②b 之后的 follow-ups（按影响排序，都不在 ②a/②b 的任务范围内）**

1. **补充层的产物到不了发布的图，并在 SAVE 时被清走。** 阶段 2.3/2.5/6b 写的是 `intermediate/annotated-graph.json` 与 `validated-graph.json`（②a 的定稿：UA 的产物不变），而 `knowledge-graph.json` 存的是 `assembled-graph.json`；Phase 7 第 4 步又把 `intermediate/` 除 `scan-result.json` 外全部 `mv` 进 `.trash-*`（7 天后清）。**后果**：`coverage`/`gaps`/边的 `provenance`/节点的 `verification`/`project.model` 目前只活在中间目录与回收站里，MCP（第 ④ 步）和 dashboard 都读不到。`meta.json.excavator` 能过增量 finalize（`{...previous}`），但会被全量 SAVE 的重写覆盖。要么加一个「发布补充字段」的新阶段（7b），要么让 ④ 直接读 `validated-graph.json`——是个需要用户定的方向题。
2. **纯 cosmetic 提交仍然看不到 dirty。** `SKIP` 分支跑完 `finalize-incremental.mjs` 就 STOP，阶段 2.3 根本不执行，所以 dirty 标记只落在**到得了 2.3 的运行**上（PARTIAL/ARCHITECTURE/FULL 且计划里带 cosmetic 文件）。而这正是这个功能写给的那一种提交。要修就得给 SKIP 分支加一步（改 Phase 0 的现有表格，本步不允许）。同一段的 UA 行为——cosmetic SKIP 上 commit 标记照旧前进——是有意保留的。
3. **抽取器修复仍在存分支**：见下面的清单。`owners` 在真实运行里几乎永远为空（今天只有 Go/Rust/C++ 报 `owner`），所以 `identity-collision` 只能靠「同文件同名多声明」判定。
4. **`owner` 不进 id**：同名不同接收者的声明仍合成一个节点，`owners` + 计数让它可见但不修正（wcp 3,497→2,825）。改 id 格式属于改 UA 产物，需单独批准。
5. **freshness 的 `no-git` 理由未实现**：spec 要求非 git 目标报 `unknown/no-git`，`staleness.ts` 的理由联合里没有这个值，实跑给的是 `missing-graph-commit`。加一个联合成员 + 判定即可，但会动 core 与既有 core 测试，不在 10.1–10.3 的范围内。
6. **Phase 7 的 fingerprint-input 模板写死 `gitCommitHash: "<current commit hash>"`**：非 git 目标要靠宿主写 `null`（脚本现在接受了），SAVE 那段文本未改。
7. **`project.model` 默认 `unknown`**：宿主没导出 `EXCAVATOR_MODEL`/`CLAUDE_MODEL`/`ANTHROPIC_MODEL`/`CLAUDE_CODE_MODEL` 时就是 `unknown`；要拿到真名得在 Phase 2.3 的调度处传 `--model`（现有段落，本步不动）。
8. **imports 证据窗口 12 行**：超过 12 行的 import 语句会留一条 `edge-contradicted`（②a 实测 wcp 上恰好 1 条）。
9. **`calls` 永不补边**：wcp 上 59,562 个调用点解析不到声明，是读者的缺口而不是图的漏洞，留给第 ③ 步的框架规则与 roadmap。
10. **C# 解析器本体**：`using` 按「命名空间 = 目录」概略解析（`resolveCSharpImport` → `resolveDottedFqn`），`owner` 与成员覆盖未复核（在存分支的 3.3 里）。

**存分支清单（做过但按方向暂缓，等单独批准）**
- `v2/deferred-ua-extractor-fixes`（commit `4d2350e2`，已 revert 出主线）：TS 对象字面量与类方法成函数、PHP trait/enum/匿名类、TS/PHP/C#/Java/Kotlin 的 `owner`、身份夹具集。影响：`identity-collision` 目前只能靠「同名多声明」判定，`owners` 在真实运行里永远为空——`extract-structure-result.mjs` 的映射今天不透传 `owner`。今天真正会填 `owner` 的抽取器只有 Go（接收者）、Rust、C++。

**验收（②a，无模型）**：a1 先验装置 1/1 与 0/0；a2 structure-all 与 annotate 两次运行 sha256 相等；a3 wcp `identity-collision` 计数与样本；a4 图中 100% 边有 `provenance`，`extracted` 边的 evidence 覆盖率、`edge-auto-inferred` 按类型、补边数、`edge-missing` 按类型；a5 cebreo `coverage.byLanguage` 含 html/xaml 为 `no-extractor` 与各 `gaps` 计数；a6 `pnpm -r build` 先行 + `pnpm test`/core/typecheck/check-refs 全绿且用例只增；a7 **UA 产物原样通过**——对 wcp 现有 `.excavator/knowledge-graph.json` 跑 annotate：0 节点/0 边被删，模型写的字段逐条相同。

## 4. 第 ③ 步：支持 cebreo（1–2 周）

cebreo = `/Users/57block/Documents/excavator-test-repos/cebreo/{uneeg-managementportal,unmc}`：966 .cs、622 .html、405 .ts、380 .kt、128 .xaml、24 .feature（盘点复核六项全对）。UA 已有 csharp/kotlin/typescript 抽取器，**没有 XAML**，HTML 只算标记文件。
【修正】两个目录**都不是 git 仓库**（无 `.git`）：`project.gitCommitHash` 取不到，用全部被分析文件 contentHash 的聚合 sha256 作「对应提交」，字段 `project.sourceDigest`（有 git 时二者都记）；新鲜度（§3.6）本就按 contentHash 走，不受影响。结构提示（计数）：5 `.csproj`、2 `.sln`、1 `angular.json`、3 `build.gradle*`、1 `AndroidManifest.xml`、1 `App.xaml`、125 `.xaml.cs`。

顺序按「对流程的影响」：
1. **先普查**：对 cebreo 跑确定性阶段，看 `coverage`：每语言零符号文件、跳过原因、为零的种类。用这张表排后面的活，不猜。
2. **C#**：records / partial class / 特性；路由（`[Route]`、`[HttpGet]`…）、守卫（`[Authorize]`）、EF 表（`DbSet<>`、`[Table]`）→ 用**规则抽取器**给出 endpoint/guard/table 节点（见 4 条）。
3. **Angular（.ts + 622 .html）**：组件与模板绑定；HttpClient 调用站点 → 前后端绑定边（唯一匹配才绑，多义进 gap）。
4. **规则抽取器插件**（新 `packages/core/src/plugins/extractors/rules-extractor.ts`，`@ast-grep/napi`）：读 `rules/<lang>/<framework>/*.yml`（从旧仓 `packages/compiler/adapters/rules/**` 按需复制，规则 metadata 声明产出种类与锚点），产出 endpoint / table / guard / http-call / ui-message / form-rule 节点与边，全部带 `evidence.source='rule'`。这是 UA「新种类要改核心源码」的替代：**以后新框架 = 一组 YAML + fixture**。
5. **XAML**：新 parser 插件：`x:Class`、`{Binding}`、`Command` → 视图节点与到 C# ViewModel 成员的绑定边（旧仓 XAML reader 可作参考）。
6. **Kotlin**：按普查结果补（Android Activity/ViewModel 或服务端框架，先看再定）。
7. 框架提示词：`skills/excavator/frameworks/{aspnet,angular,android,xaml}.md`。

**验收（【修正】只用 wcp + cebreo 真值，ombi/tolgee 退出）**：手写真值三条流程——cebreo 两条 + wcp 请假一条（wcp 以 UA 领域图的 23 步为起点逐步回源码核对，UA 漏的补、UA 错的删；格式同 koel 真值：8 类记录 entry/route/chain/data/external/guards/state/frontend_rules，每条 file/line/endLine）。用**重写的** `truth-score`（旧评分器读旧内核的 KnowledgeEpoch，不适配、直接对 v2 `knowledge-graph.json` 重写；评分语义照 `criteria.md`：锚点容差 ±2 行或在声明跨度内，三态 found / found-no-anchor / missing；**严格 = found**，**宽松 = found + found-no-anchor**）出逐跳表：UA-原版 vs v2，present / correct / anchored / fabricated。门槛：**编造 0**（硬）；**锚点率 = found / (found + found-no-anchor) ≥ 90%**（`criteria.md` 自己的「低于 90% 只配当候选生成器」规则）；各类召回只记录、对比 UA 原版，不设门（覆盖是软指标）。先验装置照旧——先喂一份故意写错行号/写错文件的真值，评分器必须判 missing。干净代理测试（只给 `.excavator/` 产物）对 cebreo 一条流程 yes/partly/no。

## 5. 第 ④ 步：MCP + 薄 PRD skill（1 周）

【修正·零兼容】不沿用旧 `packages/mcp-contract` 的 10 工具契约，不移植旧 `packages/mcp-server`；旧 `skills/prd-from-code`（21 文件约 6,900 行、4 阶段流程、925 行 Python 闸脚本）整套弃用。两者只作参考。

**薄 PRD 模版**（用户 2026-09-10 给定；去掉「验收标准」「产品待确认问题」两节与所有「待产品确认」标记；每节只写代码能反映的事实，写不出的写「代码未体现」并计入 gap，不填产品推断）：
1 文档信息（类型 As-Is、来源、`sourceDigest`/commit、`pipelineVersion`）· 2 功能背景与目标 · 3 范围（3.1 包含 / 3.2 不包含）· 4 用户角色 · 5 核心业务对象 · 6 状态模型（6.1 定义 / 6.2 转换 / 6.3 不允许的转换）· 7 功能流程（每条子流程一节）· 8 业务规则 · 9 权限矩阵 · 10 异常处理 · 11 通知规则 · 12 代码证据索引。
skill 只做三件事：选主流程 → 按模版逐节查图/查源码 → 渲染。不设多阶段规划、不要求读者确认。

**MCP 工具集由模版每节反推**（新 `packages/mcp-server`，stdio，读 `.excavator/knowledge-graph.json` + 源码；目标 **≤ 6 个工具**，名字在第 ④ 步设计时定，下面是首轮映射）：

| 模版节 | 要回答的问题 | 原语 |
|---|---|---|
| 1 | 这份图对应哪个 digest/commit、覆盖了什么、多新 | `meta`：factsDigest、sourceDigest、coverage 摘要、gaps 计数、新鲜度四态 |
| 3、4、5、7 | 有哪些流程/角色/对象；某流程经过哪些节点、哪些边 | `search`（按文本/kind/type 查节点、边、flow）+ `get`（按 id 取节点/边/flow/gap，可带邻域深度与边种类过滤） |
| 6、8、9、10、11 | 这条陈述在源码哪一行、原文是什么、行上是否真有该记号 | `evidence`（evidence id 或 file:line → 脱敏源码片段；附「期望记号是否在行上」判定，兼作 verify） |
| 3.2、6.3 | 「不包含 X」「不允许 Y」敢不敢说 | `assert_absent`（基于普查与 coverage：scope 未覆盖 → cannot-assert，不是 absent） |
| 12 | 全部锚点可核 | `evidence` 批量 |

`/excavator-chat` 与 `-explain` 改为先查图、再经同一套 evidence 函数回到源码后作答；否定句必须走 `assert_absent`。

**验收**：新薄 skill 对 wcp 请假流程与 cebreo 一条流程各出一份 PRD，Opus 审计编造 0，每节「代码未体现」计数进报告；wcp 三条流程（submit-leave-request、decide-leave-request、再从其余 15 条流程任取一条）用 `/excavator-chat` 各问一次，逐跳表 + 负向探针（例：「请假审批通过后会发短信吗」→ 必须答「不能断言」或引用 assert_absent 给出有证据的否定）；MCP 全部工具用 stdio 真实调用一遍并核对与图的一致性；完成后把 `~/.claude.json` 里的 `excavator-wcp` 指到新 server。

## 6. 之后（不在这四步里，但设计时留口）
- **性能**：按流程叙述（骨架从路由与入口确定性推出，只有骨架上的文件让模型读）；领域分组从路由前缀出发而不是全图归纳；缓存键 = 流程的证据 id 集合。目标是把 wcp 两小时压到十几分钟，第一版量了再说。
- **dashboard**：显示 evidence / inferred 虚线 / gap 节点 / 覆盖表；多仓工作区声明与跨仓绑定边。

## 7. 执行纪律（写进新仓 `AGENTS.md`，只这几条）
- 无人值守：判断题自己拍板并写下理由；不问用户。
- 一 coder 一 acceptor；编码/机械活 Sonnet，判断/审计/验收 Opus；每步一个 openspec change + 一个 PR 对 `excavator-v2`；验收 oracle 在动手前写死。
- **分阶段 commit、可按步 revert**（用户 2026-09-10）：一个逻辑步一个 commit，不攒一堆；PR 用 `gh pr merge --merge`（merge commit）而不是 squash——既能 revert 单个 commit 也能 revert 整个 PR，且 SHA 不变、评审评论不失效。
- 流程走 OpenSpec：`/openspec-propose` 生成 proposal/design/specs/tasks → 自审 → `/openspec-apply-change` → 验收 → `/openspec-archive-change`；不设用户确认闸（无人守）。
- 先验装置再用装置：任何验证器/评分器先用已知假样本证明它看得见。
- 没有第四态：每个输入落一个可见桶；某语言/种类零记录必须在 `coverage`/`gaps` 里出现。
- 身份夹具：同内容不同路径、同名不同 owner。
- 零编造是硬指标，覆盖是软指标；汇报时「编造 vs 遗漏」分开算。
- 钉死导入的 UA 提交（`5feed1f2`）；不同步上游、不提上游 PR；`NOTICE` 常在。
- **零兼容**：不保留 UA 旧目录/旧名的兼容分支；不沿用旧 excavator 的任何契约；旧资产按路径复制后改，不整仓迁移。
- **数据目录唯一**：`.excavator/`，常量单一来源；`.ua`、`.understand-anything` 字面量在源码出现即 grep 门红。
- PR 规则沿用旧仓 `docs/development.md` 里仍适用的两条：验证无误的 PR 可自行 squash 合并；只有交付完整 Linear issue 的 PR 才带 ID，其余用 `chore:`/`docs:`/`meta:` 前缀且分支名不含 ID。

## 8. 已知缺陷清单（file:line，导入后逐条处理，处理结果写进 PR）
1. `packages/core/src/types.ts` GraphEdge 无 evidence/provenance 字段 → §3.1
2. `packages/core/src/schema.ts:431-432` lineRange/filePath 可选 → function/class 节点改必填，file 节点 filePath 必填
3. `packages/core/src/plugins/extractors/typescript-extractor.ts:319-357`（【修正】原引 138-168 有误）`extractVariableDeclarations` 不递归对象字面量 → 方法零函数（koel 58.2% TS 调用的 caller 不是已声明符号）
4. `packages/core/src/plugins/extractors/php-extractor.ts:148-187` `walkStatements` 只有 class（157）/interface（165）两个 case；trait/enum/匿名类整块跳过、内部方法一起不可见
5. `packages/core/src/plugins/parsers/index.ts:31-44` 只有 graphql/protobuf 产 `endpoints`；file-analyzer 提示词承诺的 endpoint 种类无实现 → §4 规则抽取器
6. `packages/core/src/languages/configs/` 无 `.vue`、无 `.xaml` → 前者按需，后者 §4.5
7. `packages/core/src/plugins/symbol-coverage.ts` `COVERAGE_LANGUAGES` 排除 PHP/Java/Kotlin/C#/Swift/Scala/Dart，且缺口只用于增量删除校验、不进发布图 → §3.5
8. `scripts/lib/large-repo-benchmark.mjs:1487` 跳过文件不进分母
9. `skills/understand/finalize-incremental.mjs:408-422` SKIP 路径推进 commit 标记 → §3.6
10. `skills/understand/SKILL.md:688-752`（标题在 684）验证器只查引用完整性、不触源码 → §3.4
11. `agents/file-analyzer.md` 让模型转写结构 JSON 并按批「筛选」calls 边 → §3.2
12. `hooks/hooks.json:19` 「不问用户就执行」 → §2
13. 节点 id 无 owner → §3.3（wcp 19% 坍缩）
14. `agents/*.md` 不写 `model` → 保留（跟随宿主），但 `project.model` 记录实际模型名
15. `understand-anything-plugin/vitest.config.ts` 故意解析零测试、遮蔽外层聚合配置；plugin `package.json` 的 `test` 是指向外层 `tests/skill` 的 stub → §1 扁平化时以外层配置为根，导入提交用例数 = oracle
16. `packages/core/src/persistence/index.ts:7-21` 数据目录常量 + 10 处散落的 `.understand-anything` 回退判定 → §2 删兼容、单一来源
17. UA 检出工作树 `understand-anything-plugin/pnpm-lock.yaml` 有未提交修改 → §1 用 `git archive 5feed1f2` 导入

## 9. 未完成的评测（供参考，不阻塞）
- UA 有模型运行在 koel 上只完成 22/36 批（`plugin-run/logs/PROGRESS.md`；koel 主 clone 无 `.ua`，只有 `plugin-run/koel/` 的 APFS 克隆有）；wcp 的 `.ua` 完整（7,611 节点 / 24,460 边，领域图 6 域 19 流程 121 步）；`NOTES.md` 只覆盖 koel 无模型阶段，wcp 全部数字出自 `wcp-quality/scripts/*.out.txt` 与 `.ua` 文件本身，65+60 分钟由文件 mtime 推得；wcp 质量审计只完成清单、calls 边核验、身份坍缩三项（`tools/understand-anything/wcp-quality/scripts/*.out.txt`），流程逐跳表与干净代理测试未做。第 ② 步验收时会补齐同等测量。
