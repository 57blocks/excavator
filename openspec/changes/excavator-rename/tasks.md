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

- [ ] 3.1 `packages/core/src/persistence/index.ts`：`EXCAVATOR_DIR = ".excavator"`，删 `LEGACY_UA_DIR`/`resolveUaDirName`，导出 `resolveDataDir`；验证 core 测试绿
- [ ] 3.2 删全部回退分支（design D3 列表 11 处）与 agents/SKILL.md 里的三元式；`staleness.ts` pathspec、dashboard `vite.config.ts`、viewer `bin/viewer.mjs`、`prepare-incremental.mjs` GENERATED_ROOTS 同步；验证 `grep -rnE '\.understand-anything|\.ua\b' packages skills agents hooks src scripts tests` 为空
- [ ] 3.3 `.understandignore` → `.excavatorignore`：`ignore-filter.ts`、`ignore-generator.ts`、`generate-ignore.mjs`、`scan-project.mjs`、`prepare-incremental.mjs`、agents/SKILL.md、core 测试；验证 `grep -rn understandignore` 为空且生成器测试写出 `.excavatorignore`
- [ ] 3.4 `DEFAULT_IGNORE_PATTERNS` 加 `.claude/ .agents/ .codex/ .excavator/`；`scan-project.mjs` 自排除同步；验证新增单元测试「scanner 自排除 ⊆ DEFAULT_IGNORE_PATTERNS」绿
- [ ] 3.5 新夹具测试：项目含 `.claude/skills/x/SKILL.md`、`.agents/skills/y/SKILL.md`、`.codex/z.md`、`.excavator/config.json`，scan 清单不含它们且账目 `ignored` 计 4；验证测试绿

## 4. 两宿主：脚本定位、安装器、安装测试（commit 4）

- [ ] 4.1 三份 SKILL.md（excavator / -dashboard / -domain）的 PLUGIN_ROOT 候选缩为 `${CLAUDE_PLUGIN_ROOT}`、`$HOME/.excavator-plugin`、`$SELF_RELATIVE` 三项；`-knowledge`、`-figma` 的 `<SKILL_DIR>` 改同一机制；`hooks/auto-update-prompt.md` 候选同步；验证 `grep -rn 'understand-anything-plugin\|\.codex/\|\.opencode/\|\.pi/\|\.copilot/' skills hooks` 为空
- [ ] 4.2 新 `install.sh`（Codex：逐 skill 符号链接到 `~/.agents/skills/` + `~/.excavator-plugin`；`--uninstall`）；删 `install.ps1`；验证临时 HOME 下运行后 9 个 `~/.agents/skills/excavator*/SKILL.md` 存在、`~/.excavator-plugin` 指向仓库根，`--uninstall` 后全部消失
- [ ] 4.3 `tests/install/*` 重写为对新 `install.sh` 的表驱动测试（临时 HOME）；commit 说明逐条列出删除的上游用例名与新增用例名；验证 `pnpm test` 0 fail，root 用例数 = 789 − 删 + 增（写明）

## 5. hooks 只建议不执行（commit 5）

- [ ] 5.1 `hooks/hooks.json` SessionStart 命令删 "Do not ask the user for confirmation — just do it"，改为「读取提示文件并向用户建议」；验证 `grep -rn 'Do not ask the user' hooks/` 为空
- [ ] 5.2 `hooks/auto-update-prompt.md` 结尾改为建议 + 等待用户；`post-tool-use-auto-update.mjs` 只写提示不触发分析；验证 `tests/hooks/*` 更新后绿

## 6. 引用完整性门（commit 6）

- [ ] 6.1 `scripts/check-refs.mjs` 实现 design D8 六项检查，非零退出逐条打印；验证 `node scripts/check-refs.mjs` exit 0 并打印检查计数
- [ ] 6.2 `tests/refs/check-refs.test.mjs`：用例 A 对仓库跑 exit 0；用例 B 复制树到临时目录、重命名一个 agent 文件、断言非零且输出点名该 agent 与引用它的文件；验证两条用例绿
- [ ] 6.3 接进 `pnpm test`（vitest include 覆盖 `tests/refs/**`）；验证 `pnpm test` 输出含该文件

## 7. 守卫与文档（commit 7）

- [ ] 7.1 `.claude/settings.json` push 守卫拦 `main|excavator-v2`；验证 JSON 合法且守卫正则含两个分支名
- [ ] 7.2 `docs/v2-plan.md` §2 增补：命名表、11 处回退站点已删、`UA_DIR` 非 env 的修正已落地、Claude Code 前缀调用形式；验证 `pnpm typecheck` 绿

## 8. 冒烟（不提交产物；结果贴 PR）

- [ ] 8.1 wcp：拷基线到 `<excavator-eval>/tools/understand-anything/wcp-quality/baseline-ua/` → `mv .ua .excavator`、`mv .understandignore .excavatorignore`、删 `.trash-*` → dashboard 打开 → 增量路径识别；验证 dashboard 加载节点数 7,611、增量只报预期变更
- [ ] 8.2 wcp 与 cebreo 确定性阶段（scan → import-map → batches → extract-structure）各跑一次；验证 `find <target> -name .ua` 为空、`.excavator/intermediate/` 存在，cebreo 每语言文件数/解析数/零符号数/跳过原因计数表贴 PR
