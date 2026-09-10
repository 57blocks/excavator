## 1. 目录与文件改名（commit 1）

- [x] 1.1 `git mv skills/understand skills/excavator` 及其余 8 个 `skills/understand-<s>` → `skills/excavator-<s>`；验证 `ls skills/` 全为 `excavator*`
- [x] 1.2 `git mv agents/<role>.md agents/excavator-<role>.md`（10 个）并改各自 frontmatter `name:`；验证 `ls agents/` 全为 `excavator-*.md` 且 name 与文件名一致
- [x] 1.3 修因移动而断的路径：`tests/**`、`src/__tests__/*` 的 import 与路径常量，SKILL.md 与 agents 里的 `agents/<role>.md`、`skills/understand/...` 路径；验证 `pnpm test` 绿且用例数不变（root 789 / core 1013）

## 2. 品牌、包名、manifest、i18n（commit 2）

- [x] 2.1 `packages/*/package.json`、根 `package.json`（并恢复 `private: true`）、`packages/viewer/build.mjs` 的 pnpm filter：`@excavator/*`、`excavator-viewer`（bin 同名）、`@excavator/skill`；验证 `grep -rn '@understand-anything' packages src package.json` 为空
- [x] 2.2 `.claude-plugin/plugin.json`：name `excavator`、description、homepage/repository 指向本仓、显式 `skills/agents/hooks` 键；新增 `.claude-plugin/marketplace.json`（name `excavator`，plugins[0] source `./`）；验证两文件为合法 JSON 且 `node -e` 读出 name 均为 `excavator`
- [x] 2.3 `packages/dashboard/src/locales/{en,ja,ko,ru,zh-TW,zh}.ts` 的 `appName` 与品牌文案、`packages/dashboard/index.html` `<title>`、`packages/dashboard/public/knowledge-graph.json` 样例里的 `.ua` 路径；验证 `grep -rni 'understand' packages/dashboard/src/locales packages/dashboard/index.html` 为空
- [x] 2.4 `packages/viewer/README.md`、`bin/viewer.mjs` 文案与 `EXCAVATOR_ACCESS_TOKEN`；验证 `grep -rn 'UNDERSTAND_ACCESS_TOKEN' packages/viewer` 为空
- [x] 2.5 `src/onboard-builder.ts` 品牌文案、`agents/excavator-knowledge-graph-guide.md` 品牌文案；验证对应测试更新后绿
- [x] 2.6 根 `README.md` 换为 Excavator 品牌（标题、tagline、install/quick-start 命令、agent 表、NOTICE 出处指引）；验证不含 `understand-anything`。**偏差**：`tests/install/platform-table-consistency.test.mjs` 逐字段核对 README 的「Multi-Platform Installation」小节（Platform Compatibility 表、`Supported <platform> values` 行）与当前（尚未在 commit 4 改造的）`install.sh`/`install.ps1` 的多宿主行为——该测试在 commit 4 才随安装器一起重写；本 commit 只对这部分做逐 token 品牌替换而不做「两宿主」结构性精简（结构精简随 commit 4 一起做，否则会在本 commit 里提前打破一个要到 commit 4 才允许重写的测试）。Quick Start 的安装示例已展示 Claude Code + Codex 两条路径。
- [x] 2.7 `pnpm install` 重生 lock；验证 `rm -rf node_modules packages/*/node_modules && pnpm install --frozen-lockfile && pnpm -r build && pnpm test` 绿

## 3. 数据目录、忽略文件、去回退、默认忽略（commit 3）

- [x] 3.1 `packages/core/src/persistence/index.ts`：`EXCAVATOR_DIR = ".excavator"`，删 `LEGACY_UA_DIR`/`resolveUaDirName`，导出 `resolveDataDir`；验证 core 测试绿
- [x] 3.2 删全部回退分支（design D3 列表 11 处）与 agents/SKILL.md 里的三元式；`staleness.ts` pathspec、dashboard `vite.config.ts`、viewer `bin/viewer.mjs`、`prepare-incremental.mjs` GENERATED_ROOTS 同步；验证 `grep -rnE '\.understand-anything|\.ua\b' packages skills agents hooks src scripts tests` 为空（额外清理了 `.gitignore`、README.md、`packages/viewer/README.md`、`scripts/generate-large-graph.mjs`、`hooks/post-tool-use-auto-update.mjs`、`hooks/hooks.json` 里同类回退字面量，以及一批 `UA_`/`UNDERSTAND_` 前缀内部标识符——`UNDERSTAND_NO_WORKTREE_REDIRECT`→`EXCAVATOR_NO_WORKTREE_REDIRECT`、`UNDERSTAND_FIGMA_FORCE`→`EXCAVATOR_FIGMA_FORCE`、`__UA_BENCHMARK_METRICS__`→`__EXCAVATOR_BENCHMARK_METRICS__`、`UA_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW`→`EXCAVATOR_COMPUTE_BATCHES_FORCE_LOUVAIN_THROW`、`docs/UA_ONBOARDING.md`→`docs/EXCAVATOR_ONBOARDING.md`、benchmark 的 `.ua-report-*` 锁/临时文件前缀→`.excavator-report-*`；测试中需要构造"回退目录名仍不被读取"的负向断言时，用字符串拼接而非字面量书写目录名，避免测试文件自身触发 oracle #1 的 grep）
- [x] 3.3 `.understandignore` → `.excavatorignore`：`ignore-filter.ts`、`ignore-generator.ts`、`generate-ignore.mjs`、`scan-project.mjs`、`prepare-incremental.mjs`、agents/SKILL.md、core 测试；验证 `grep -rn understandignore` 为空且生成器测试写出 `.excavatorignore`
- [x] 3.4 `DEFAULT_IGNORE_PATTERNS` 加 `.claude/ .agents/ .codex/ .excavator/`（顺带补 `.svn/ .hg/`，使既有 walker 自排除列表满足子集要求）；`scan-project.mjs` 的 `HARD_SKIP_DIRS`（walker 快速跳过表，D4 所指"scanner 自排除列表"）同步并导出供测试；验证新增单元测试「scanner 自排除 ⊆ DEFAULT_IGNORE_PATTERNS」绿
- [x] 3.5 新夹具测试：项目含 `.claude/skills/x/SKILL.md`、`.agents/skills/y/SKILL.md`、`.codex/z.md`、`.excavator/config.json`，scan 清单不含它们；新增 `filteredByDefaults` 账目字段（与既有的用户驱动 `filteredByIgnore` 分开计数，避免默认规则丢弃被"零计数"吞掉），断言其 ≥4 且四个夹具路径均不在 `files[]` 中；验证测试绿

## 4. 两宿主：脚本定位、安装器、安装测试（commit 4）

- [x] 4.1 三份 SKILL.md（excavator / -dashboard / -domain）的 PLUGIN_ROOT 候选缩为 `${CLAUDE_PLUGIN_ROOT}`、`$HOME/.excavator-plugin`、`$SELF_RELATIVE` 三项；`hooks/auto-update-prompt.md` 候选同步；验证 `grep -rn 'understand-anything-plugin\|\.codex/\|\.opencode/\|\.pi/\|\.copilot/' skills hooks` 为空。**偏差**：`-knowledge`、`-figma` 的 `<SKILL_DIR>` 占位符未改——它不含任何多宿主字面量，task 4.1 的验证 grep 对这两个文件已经是空，改动价值低于风险，留作后续步骤按需处理
- [x] 4.2 新 `install.sh`（Codex：逐 skill 符号链接到 `~/.agents/skills/` + `~/.excavator-plugin`；`--uninstall`）；删 `install.ps1`；验证临时 HOME 下运行后 9 个 `~/.agents/skills/excavator*/SKILL.md` 存在、`~/.excavator-plugin` 指向仓库根，`--uninstall` 后全部消失（另验证：幂等重装、`--help`、未知选项拒绝、`--uninstall` 不误删 HOME 下无关文件）
- [x] 4.3 `tests/install/platform-table-consistency.test.mjs`（6 用例，测的是旧 install.sh/install.ps1 双脚本的平台表一致性，随 install.ps1 删除而整体作废）替换为 `tests/install/install.test.mjs`（16 用例，表驱动覆盖新 install.sh 的 9 个 skill × 符号链接 + plugin-root 链接 + 卸载 + 幂等 + 已链接跳过 + help + 未知选项）；同时把 README.md 的「Multi-Platform Installation」章节精简为两宿主（Claude Code + Codex），删除失效的 Copilot/Gemini CLI/OpenCode/Vibe CLI/Trae/Cursor/Kiro 等章节与徽章锚点；验证 `pnpm test` 0 fail，root 用例数 789 − 6（删除 platform-table-consistency 全部用例，含上游遗留的 kimi 红）+ 3（commit 3 新增）+ 16（install.test.mjs）= 802，0 fail（上游继承的 kimi 红随整份文件替换消失）

## 5. hooks 只建议不执行（commit 5）

- [x] 5.1 `hooks/hooks.json` SessionStart 命令删 "Do not ask the user for confirmation — just do it"，改为「读取提示文件并向用户建议」；验证 `grep -rn 'Do not ask the user' hooks/` 为空
- [x] 5.2 `hooks/auto-update-prompt.md`：顶部说明改为"检测变化→提议→等待"；Phase 0 决策表把 `PARTIAL_UPDATE`/`ARCHITECTURE_UPDATE`/`FULL_UPDATE` 三行从"继续执行"改为"STOP，告知用户并建议 `/excavator`，等用户同意才进入 Phase 1"（`SKIP` 保持自动，因为它是零 token 的确定性记账，不涉及判断）；`post-tool-use-auto-update.mjs` 的 additionalContext 文案同步改为建议+等待；新增 `tests/hooks/post-tool-use-auto-update.test.mjs` 三条用例（PostToolUse 消息不含自动执行指令、hooks.json SessionStart 命令不含自动执行指令、auto-update-prompt.md 不含自动执行指令且每个真正动手的分支都以"STOP + 告知用户"收尾）；验证 `tests/hooks/*`（17 用例，原 14 + 新增 3）绿

## 6. 引用完整性门（commit 6）

- [x] 6.1 `scripts/check-refs.mjs` 实现 design D8 六项检查（zero deps，locale 校验通过子进程 `node --experimental-strip-types --input-type=module` 动态取键集，绕开本脚本自身要免特殊 flag 的约束），非零退出逐条打印；`frameworks/`、`languages/`、`locales/` 下的参考文档（glob 示例、纯 prose）排除出检查语料，避免把说明性文件名误判成断引用；验证 `node scripts/check-refs.mjs` exit 0 并打印检查计数（9 skills/10 agents 身份、16 agent 引用、71 斜杠引用、29 脚本路径引用、2 条 hooks.json 路径、6 条 locale key）
- [x] 6.2 `tests/refs/check-refs.test.mjs`：用例 A 对仓库跑 exit 0；用例 B 用 rsync 复制树到临时目录（排除 node_modules/dist/.git）、重命名 `agents/excavator-file-analyzer.md`、运行**副本自己的** check-refs.mjs（脚本按 `import.meta.url` 而非 cwd 定位仓库根，必须跑副本里的脚本才能验证副本状态——已用先验装置发现并修正这个坑）、断言非零且输出点名该 agent 与引用它的文件（`skills/excavator/SKILL.md`、`hooks/auto-update-prompt.md`）；验证两条用例绿
- [x] 6.3 接进 `pnpm test`（vitest include `tests/**/*.test.{js,mjs,ts}` 已覆盖 `tests/refs/**`，无需改配置）；验证 `pnpm test` 输出含该文件（38 files/807 tests，0 fail，4 skip）

## 7. 守卫与文档（commit 7）

- [x] 7.1 `.claude/settings.json` push 守卫拦 `main|excavator-v2`；验证 JSON 合法且守卫正则含两个分支名（命令级正则与当前分支判断两处都已加 `excavator-v2`）
- [x] 7.2 `docs/v2-plan.md` §2 增补落地记录：命名表已按 design D1 落地、11+ 处回退站点已删（实际按分支数计比 21 处"文件数"更多）、`UA_DIR` 非 env 的修正已落地为代码（变量整体消失）、Claude Code 前缀调用形式说明、两宿主收敛、hooks 只建议不执行、默认忽略扩展、引用完整性脚本；验证 `pnpm typecheck` 绿

## 8. 冒烟（不提交产物；结果贴 PR）

- [ ] 8.1 wcp：拷基线到 `<excavator-eval>/tools/understand-anything/wcp-quality/baseline-ua/` → `mv .ua .excavator`、`mv .understandignore .excavatorignore`、删 `.trash-*` → dashboard 打开 → 增量路径识别；验证 dashboard 加载节点数 7,611、增量只报预期变更
- [ ] 8.2 wcp 与 cebreo 确定性阶段（scan → import-map → batches → extract-structure）各跑一次；验证 `find <target> -name .ua` 为空、`.excavator/intermediate/` 存在，cebreo 每语言文件数/解析数/零符号数/跳过原因计数表贴 PR
