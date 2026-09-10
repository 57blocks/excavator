## Context

第 0 步（PR #399，merge `03170b28`）把 UA `understand-anything-plugin/` 扁平化为仓库根，测试与 oracle 相等（root 37 文件/789 用例含 1 条上游继承红 `tests/install/platform-table-consistency.test.mjs`；core 47/1013）。只读盘点（2026-09-10）给出：改名足迹 107 个文件；`.ua` 字面量 43 个文件；回退三元式在 agents/SKILL.md/hooks 里逐字复制；agent 派发全是散文写法 "Dispatch a subagent using the `<name>` agent definition (at `agents/<name>.md`)"，没有 `subagent_type:` 字面量；`plugin.json` 不枚举组件，Claude Code 按目录约定自动发现；外层 `install.sh` 未导入；`DEFAULT_IGNORE_PATTERNS`（`ignore-filter.ts:10-72`）缺 agent 目录，数据目录自排除另在 `scan-project.mjs:767` 硬编码；SKILL.md 里 8 候选安装路径含 `understand-anything-plugin` 段（dashboard 15 处、domain 10、understand 10）；根 `package.json` 在扁平化时丢了 `private: true`。官方文档确认：插件 skill 在 Claude Code 里强制带插件名前缀（`/excavator:excavator-chat`）；`marketplace.json` 的 `source: "./"` 合法；`${CLAUDE_PLUGIN_ROOT}` 是文档化变量；Codex 无官方安装机制。

## Goals / Non-Goals

**Goals:**
- 一次性、全仓、按 token 的改名，改完引用自洽并有机械门守住。
- 数据目录与忽略文件单一来源、零回退。
- 两宿主可安装可运行；hooks 不越权执行。

**Non-Goals:**
- 不改任何图/抽取/schema 行为；不动 Figma 功能；不建 MCP；不做旧 `.ua/` 迁移工具。

## Decisions

**D1 命名表**（一次定死，后续步骤引用）

| 类别 | 旧 | 新 |
|---|---|---|
| plugin | `understand-anything` | `excavator` |
| skills | `understand`, `understand-<s>` | `excavator`, `excavator-<s>`（目录名 = `name:`） |
| agents | `<role>.md` / `name: <role>` | `excavator-<role>.md` / `name: excavator-<role>` |
| 包 | `@understand-anything/*`, `understand-anything-viewer` | `@excavator/*`, `excavator-viewer` |
| 数据目录 | `.ua/`（回退 `.understand-anything/`） | `.excavator/`（无回退） |
| 忽略文件 | `.understandignore` | `.excavatorignore` |
| 安装根 | `$HOME/.understand-anything-plugin` | `$HOME/.excavator-plugin` |
| env | `UNDERSTAND_ACCESS_TOKEN` | `EXCAVATOR_ACCESS_TOKEN` |
| shell 变量 | `UA_DIR`（21 文件内联） | 固定 `.excavator`，删变量 |
| 文案 | Understand Anything / Understand-Anything | Excavator |

替代方案：skill 用短名（`analyze`/`chat`）让 Claude Code 里变成 `/excavator:chat`。否决：Codex 无前缀，短名不自描述且易撞名；用户明确要求 excavator 前缀。agent 加前缀是为避开用户机器上残留 UA 安装的同名 agent。

**D2 替换按 token 不按单词**。英文动词 "understand" 在散文里大量出现，不能全局替换。只替换 D1 表里的确定 token，顺序从长到短：`@understand-anything/` → `understand-anything-viewer` → `.understand-anything-plugin` → `Understand-Anything`/`Understand Anything` → `understand-anything` → `.understandignore` → `/understand-<s>` → `/understand`（词边界）→ 反引号 agent 名与 `agents/<role>.md` 路径 → `UNDERSTAND_ACCESS_TOKEN` → `UA_DIR` → `.ua` 目录字面量。回退三元式**手工**折叠为常量，不靠正则。做完后 `grep -rniE 'understand'` 的残余逐条分类：产品名 → Excavator；英文动词 → 保留。替代方案 sed 全局替换——否决，第 0 步 coder 已经踩过 sed 引号损坏文件的坑。

**D3 数据目录单一来源**：`packages/core/src/persistence/index.ts` 导出 `EXCAVATOR_DIR = ".excavator"` 与 `resolveDataDir(root)`；TS 侧全部改为 import；shell/Python/md 侧硬编码同一字面量，由 grep 门守住。`staleness.ts` 的 `:(exclude).ua` pathspec 同步。

**D4 默认忽略与自排除**：`DEFAULT_IGNORE_PATTERNS` 增加 `.claude/`、`.agents/`、`.codex/`、`.excavator/`；`scan-project.mjs` 自排除改为同一组；新增单元测试断言 scanner 列表 ⊆ core 列表，并用夹具证明这些目录下的文件不进清单、且以 `ignored` 原因计入账目（不是静默消失——「没有第四态」）。

**D5 两宿主脚本定位**：候选只留三项——`${CLAUDE_PLUGIN_ROOT}`（Claude Code）、`$HOME/.excavator-plugin`（安装器建立的通用符号链接）、`$SELF_RELATIVE`（`~/.agents/skills/<skill>` realpath 上两级，Codex）。校验仍是候选下存在 `package.json` 与 `pnpm-workspace.yaml`。三份 SKILL.md（excavator / -dashboard / -domain）共用同一段；`-knowledge`、`-figma` 的 `<SKILL_DIR>` 占位改为同一机制；`hooks/auto-update-prompt.md` 的候选同步。

**D6 安装**：新 `install.sh` 只做 Codex：`ln -sfn skills/<each> ~/.agents/skills/<each>` 与 `ln -sfn <repo> ~/.excavator-plugin`，支持 `--uninstall`。Claude Code 走 `.claude-plugin/marketplace.json`：`{name:"excavator", owner:{name:"57blocks"}, plugins:[{name:"excavator", source:"./", description}]}`，安装命令 `/plugin marketplace add <repo-path>` 再 `/plugin install excavator@excavator`。`plugin.json` 显式写 `skills/agents/hooks` 键以自文档。删 `install.ps1`；`tests/install/*` 重写为对新 `install.sh` 的表驱动测试（HOME 指向临时目录）。上游继承的 kimi 红因此消失，属替换非弱化，PR 里列出被删测试名与新增测试名。

**D7 hooks**：`hooks.json` SessionStart 命令保留「检测结构变化」的确定性部分；`auto-update-prompt.md` 结尾改为「列出变更并建议运行 `/excavator`，等待用户决定」；删除 "Do not ask the user for confirmation — just do it"。PostToolUse 自动更新脚本只写提示文件，不触发分析。

**D8 引用完整性门** `scripts/check-refs.mjs`（零依赖 Node）：(1) `skills/*/SKILL.md` `name` == 目录名，`agents/*.md` `name` == 文件名；(2) `skills/**/*.md`、`agents/*.md`、`hooks/*` 中反引号内与某 agent 同形的 `excavator-[a-z-]+` 与 `agents/<x>.md` 路径必须存在；(3) `/excavator(-[a-z]+)?\b` 与 `/excavator:excavator(-[a-z]+)?` 的 skill 目录必须存在；(4) `.mjs/.py/.sh` 路径去掉 `${CLAUDE_PLUGIN_ROOT}`/`$PLUGIN_ROOT` 前缀后相对仓库根或所在 skill 目录解析必须存在；(5) `hooks/hooks.json` 内 `${CLAUDE_PLUGIN_ROOT}/...` 路径存在；(6) `packages/dashboard/src/locales/*.ts` key 集合两两相等。非零退出逐条打印。vitest 包装两条用例：对仓库跑 exit 0；**先验装置**——复制树到临时目录、重命名一个 agent 文件、断言非零且点名该 agent。

**D9 push 守卫**：`.claude/settings.json` PreToolUse 守卫从只拦 `main` 扩为拦 `main|excavator-v2` 的直接 push（`gh pr merge` 不经此路径）。

**D10 wcp 复用与冒烟**：先 `cp -R wcp/.ua <excavator-eval>/tools/understand-anything/wcp-quality/baseline-ua/`，再 `mv wcp/.ua wcp/.excavator`、`mv .understandignore .excavatorignore`、删 `.trash-*`；用 `/excavator-dashboard` 打开、用 `hooks/post-tool-use-auto-update.mjs` 的增量路径识别。确定性阶段（scan → import-map → batches → extract-structure）对 wcp 与 cebreo 各跑一次，产物 `.excavator/intermediate/`，记录 cebreo 的每语言文件数/解析数/零符号数/跳过原因计数（供 ③ 用）。产物与真实路径不提交，PR 只贴计数。

**D11 调用形式**：Claude Code 实际调用是 `/excavator:excavator`、`/excavator:excavator-chat`；Codex 是 `/excavator`、`/excavator-chat`。SKILL.md/agents/hooks 的散文统一写裸名（宿主中立），README 用一段说明 Claude Code 的前缀形式。`${CLAUDE_PLUGIN_DATA}` 可在后续步骤用作缓存位置，本步不用。

## Commit plan（每个 commit 单独绿，分支 `v2/step1-rename`）

0. `docs(openspec): propose excavator-rename`——本 change 的四份产物。
1. `refactor(rename): move skill dirs and agent files to excavator-* names`——只 `git mv` + 修因移动而断的路径引用。
2. `refactor(rename): brand, package names, manifests, i18n, private:true`——`@excavator/*`、viewer、plugin.json、marketplace.json、locales、index.html、README、`src/onboard-builder.ts` 文案、lock 重生。
3. `refactor(rename): data dir .excavator, .excavatorignore, drop legacy fallbacks, default-ignore agent dirs`——D3 + D4 + 测试。
4. `feat(hosts): three-candidate script resolution, install.sh for Codex, remove install.ps1, rewrite install tests`——D5 + D6。
5. `fix(hooks): session-start hook proposes, never auto-executes`——D7。
6. `test(refs): check-refs gate with instrument test`——D8。
7. `chore: push guard covers excavator-v2; docs/v2-plan.md §2 amendments`——D9 + 文档。

## Acceptance oracle（动手前写死；Opus acceptor 逐条复测）

| # | 判据 | 方法 |
|---|---|---|
| 1 | 旧名零命中 | `grep -rniE 'understand-anything\|understandignore\|UA_DIR\|\.ua\b' --exclude-dir={node_modules,.git,dist,docs,openspec} .` 只命中 `NOTICE`（`openspec/` 里的规划产物描述改名本身，排除） |
| 2 | 斜杠名与 agent 名零残余 | `grep -rnE '(^\|[^a-z])/understand(-[a-z]+)?\b' skills agents hooks` 为空；`ls agents/` 全为 `excavator-*.md`；`ls skills/` 全为 `excavator*` |
| 3 | check-refs 绿且装置红 | `node scripts/check-refs.mjs` exit 0；vitest 装置用例通过 |
| 4 | 三件套绿 | `pnpm install --frozen-lockfile && pnpm -r build && pnpm test && pnpm typecheck`；root 用例数 = 789 − 被替换安装测试数 + 新增数（PR 列明），core = 1013；0 fail |
| 5 | wcp 复用 | dashboard 打开改名后的 `wcp/.excavator`；增量路径识别并只报预期变更 |
| 6 | 确定性冒烟 | wcp、cebreo 各产出 `.excavator/intermediate/`；两目标下 `find -name .ua` 为空；cebreo 普查计数表贴 PR |
| 7 | hooks 无自动执行 | `grep -rn "Do not ask the user" hooks/` 为空；acceptor 读提示词确认结尾是建议 |
| 8 | 安装 | 临时 HOME 下 `install.sh` 生成 9 个符号链接 + 通用根；`--uninstall` 清干净 |
| 9 | 残余 "understand" 抽查 | acceptor 抽 20 处 `grep -rni understand` 命中，全部是英文动词而非产品名 |

## Risks / Trade-offs

- [正则误伤英文 "understand"] → D2 只按 token；残余人工分类；acceptor 抽查 20 处（oracle #9）。
- [包名变更导致 lock 大 diff] → 单独 commit；`--frozen-lockfile` 复核。
- [上游安装测试替换被误认为弱化] → PR 逐条列出删/增用例名与理由；用例总数不减。
- [Claude Code 前缀调用与文档裸名不一致] → README 一段说明；check-refs 两种形式都接受。
- [wcp 改名后 UA 领域图仍是模型产物] → 本步只验证可打开、可识别，不验内容；内容在第 ② 步重建。

## Migration Plan

无外部用户。回滚 = `git revert` 对应 commit（每个 commit 独立绿）或 `git revert -m 1 <merge>` 整个 PR。wcp 的 `.ua/` 基线保存在 excavator-eval 下，可原样恢复。
