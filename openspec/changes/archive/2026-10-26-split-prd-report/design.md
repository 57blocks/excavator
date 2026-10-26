## Context

- PR #81（合并提交 `33c1566d`）把 `skills/excavator-prd/` 换成流水线。合并前的主线是 `33c1566d^1`；从它的分支起点到合并，主线上没有别的提交改过 `skills/excavator-prd/`、`tests/skill/test_prd_skill_contract.test.mjs` 与 `openspec/specs/prd-generation/spec.md`，所以 `33c1566d^1` 上的这几份就是单篇版本的最终形态。
- 单篇版本在 PR #81 之前已用真实语料验收过；流水线在 PR #81 里用 go-multirepo 的子项目验收过（见 `archive/2026-10-23-prd-feature-pipeline/design.md` 的验收记录）。本变更不改两者的行为。

## Goals / Non-Goals

**Goals**
- `/excavator-prd` 与 PR #81 之前逐字节相同。
- `/excavator-prd-report` 与 PR #81 的流水线只差名字。
- 每个提交单独是绿的。

**Non-Goals**
- 报告页（下一个变更 `prd-report-page`）。
- 改流水线的任何行为、修 PR #81 验收记录里列出的已知问题。

## Decisions

### D1 新 skill 叫 `excavator-prd-report`

和 `excavator-prd` 排在一起好找；`report` 指它的交付物——一个目录加下一个变更要加的报告页。不叫 `excavator-prd-suite`、`excavator-product-*`：前者不说明交付什么，后者和现有 skill 的命名没有关联。名字不暗示用途或建议（As-Is）。

### D2 单篇版本按 `33c1566d^1` 逐字节恢复

用 `git checkout 33c1566d^1 -- <路径>` 恢复，不手写。理由见 Context：那就是单篇版本的最终形态，且已验收过，逐字节相同就不必重新验收。

### D3 流水线只改名

替换表只有两条，按顺序对所有复制过来的文件做全文替换：

| 原文 | 替换为 |
|---|---|
| `excavator-prd` | `excavator-prd-report` |
| `.excavator/prd` | `.excavator/prd-report` |

它覆盖了 skill 名、`SKILL.md` 的 `name` 与标题、命令里的路径、测试里的路径、`--out` 默认值（`reply` 判断「是默认位置」随之改）与三个 `format` 标识（零兼容，不认旧标识）。不在表里、因此不改的：
- 脚本文件名 `prd.mjs`：它就是 PRD 流水线的脚本，改名只增加改动；
- 回复里保存进项目的提议（`docs/PRD.md`、`docs/PRD-<scope>.md`）；
- 注释里指向 openspec 变更的引用（`prd-feature-pipeline`）：那是代码的来历；
- 夹具的内容：新测试用复制出来的 `tests/fixtures/prd-report-pipeline/`（只有两个 JSON 的 `format` 按表替换），新测试里指向夹具的两处路径随之改；旧的 `tests/fixtures/prd-pipeline/` 在提交 3 里随旧测试删掉，净效果是夹具目录改名。不改共享夹具，是因为提交 2 里旧测试仍在跑、仍检查旧 `format`。

唯一的例外是新 `SKILL.md` 的 `description`：改写开头，说清它写的是「每个功能的 PRD 章节与 findings，产物是一个目录」，与单篇版的 `description` 区分开，否则两个 skill 的触发描述几乎相同，模型分不清该用哪个。

### D4 提交顺序：先复制，再恢复

1. `docs(openspec): propose split-prd-report`
2. `feat(prd-report): add excavator-prd-report from the feature pipeline` — 复制流水线、测试与夹具到新位置并改名；安装测试的 skill 数从 15 改为 16 并期待新名字（不在这一步改，这个提交就是红的）。此时两个目录都有流水线，测试各自通过。
3. `revert(prd): restore the single-document excavator-prd` — 恢复 `skills/excavator-prd/` 与旧契约测试，删掉 `tests/skill/excavator-prd/` 与 `tests/fixtures/prd-pipeline/`。
4. `docs: list excavator-prd-report beside excavator-prd` — `README.md`、`docs/deploy.md`。
5. `docs(openspec): record split-prd-report acceptance`

先移动会让第 2 步之后 `excavator-prd` 没有 `SKILL.md`，安装测试变红；先复制则每步都绿。

## Risks / Trade-offs

- 两个 skill 的写作规则会各自漂移（单篇版的 Phase 3 与流水线泳道提示词原本同源）。接受：两者用途不同，以后各自演进；共用部分如需收敛另开变更。
- 第 2 步的提交里同一套测试跑两遍，CI 时间多约一份测试的耗时，只持续一个提交。

## Acceptance oracles

动手前写死：

- **O1 恢复逐字节**：`git diff 33c1566d^1 HEAD -- skills/excavator-prd tests/skill/test_prd_skill_contract.test.mjs` 为空；归档后 `openspec/specs/prd-generation/spec.md` 与 `33c1566d^1` 上的同一文件按要求逐条比较：要求与场景的文本全部相同，只差「完整流程清单覆盖全流程」改名为「单篇 PRD 的流程清单覆盖全流程」并移到末尾（OpenSpec 不允许 MODIFIED 丢场景，也不允许同名先删后加）。
- **O2 只改名**：把 `33c1566d` 上的 `skills/excavator-prd/`、`tests/skill/excavator-prd/`、`tests/skill/test_prd_skill_contract.test.mjs`、`tests/fixtures/prd-pipeline/` 导出到临时目录，按 D3 的替换表做文本替换，与 HEAD 上对应的新路径 `diff -r`（夹具对 `tests/fixtures/prd-report-pipeline/`，并把替换表外加上夹具路径 `prd-pipeline` → `prd-report-pipeline` 只用于新测试里的两处引用），结果只有新 `SKILL.md` 的 `description` 一行。装置先验：在替换表里故意漏一项，`diff -r` 必须报出差异。
- **O3 门**：三件套、`node scripts/check-refs.mjs`、`openspec validate --all --strict`、CI 模拟重跑（短 TMPDIR、`user.useConfigOnly=true`），每个代码提交在分离检出里各跑一次。
- **O4 无残留**：`skills/excavator-prd-report/` 与 `tests/skill/excavator-prd-report/` 里 `skills/excavator-prd/`、`.excavator/prd"`、`excavator-prd/1` 的出现次数为 0。
- **O5 插件**：`claude plugin validate .` 通过，安装测试同时列出 `excavator-prd` 与 `excavator-prd-report`。
- 不跑真实语料：O1 证明单篇版与已验收版本相同，O2 证明流水线只差名字，真实运行不提供新信息（按「验收按风险分级」）。

## 验收记录（2026-10-26）

验收者只检查、不改代码；每个代码提交在 `git clone --no-hardlinks` 的分离检出里单独跑，跑完即删。

### O3 门（逐提交）

| 提交 | install | build | `pnpm test` | check-refs | typecheck | `openspec validate --all --strict` | legacy-literals | CI 模拟重跑（短 TMPDIR + `user.useConfigOnly=true`） |
|---|---|---|---|---|---|---|---|---|
| `dc37a07b` | 过 | 过 | 239 文件；5235 过、4 跳过（共 5239） | 过 | 过 | 51/51 | 6/6 | 239 文件；5235 过、4 跳过 |
| `dbfb27bf` | 过 | 过 | 227 文件；5110 过、4 跳过（共 5114） | 过 | 过 | 51/51 | 6/6 | 227 文件；5110 过、4 跳过 |
| `cc38acad` | 过 | 过 | 227 文件；5110 过、4 跳过（共 5114） | 过 | 过 | 51/51 | 6/6 | 227 文件；5110 过、4 跳过 |

- `dc37a07b` → `dbfb27bf` 少 12 个测试文件，等于 `dc37a07b` 上 `tests/skill/excavator-prd/` 的 12 个 `*.test.mjs`。
- 未在本地跑：`pnpm --filter @excavator/core test`（三个提交都没动 `packages/core/`，CI 会跑）；隐私扫描（`scripts/ci/privacy-scan.mjs` 必须有名单文件，没有名单时退出 2，由 CI 用仓库 secret 跑）。

### O1（skill 与测试部分）

`git diff 33c1566d^1 cc38acad -- skills/excavator-prd tests/skill/test_prd_skill_contract.test.mjs`：0 字节。`skills/excavator-prd/` 在两端都只有 `SKILL.md` 1 个文件。spec 部分留到归档（4.2）。

### O2 只改名

导出 `33c1566d` 上的 4 处路径（68 个文件），按 D3 顺序替换，再在 `tests/skill/test_prd_skill_contract.test.mjs` 与 `tests/skill/excavator-prd/helpers.mjs` 两处把 `fixtures/prd-pipeline` 换成 `fixtures/prd-report-pipeline`，与 `cc38acad` 上的新路径（68 个文件）`diff -r`：

- 装置先验（漏掉第二条 `.excavator/prd` → `.excavator/prd-report`）：42 行输出，6 个文件有差异：`skills/excavator-prd-report/` 的 `SKILL.md`、`lib/reply.mjs`、`prd.mjs`，`tests/skill/excavator-prd-report/` 的 `aggregate.test.mjs`、`entrypoints.test.mjs`，与 `tests/skill/test_prd_report_skill_contract.test.mjs`。
- 完整替换：5 行输出，1 个文件有差异，只有 `skills/excavator-prd-report/SKILL.md` 第 3 行 `description`；无 `Only in`。

### O4 无残留

`cc38acad` 上 `skills/excavator-prd-report/`、`tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs` 内：`skills/excavator-prd/` 0、`.excavator/prd"` 0、`excavator-prd/1` 0。对照（`33c1566d` 的旧路径，同一命令）：22、1、3。

### O5 插件

`claude plugin validate .`：通过（marketplace 清单）；`claude plugin validate .claude-plugin/plugin.json`：通过，1 条警告（根目录 `CLAUDE.md` 不作为插件上下文加载，与本变更无关）。`tests/install/install.test.mjs` 期待 16 个 skill，含 `excavator-prd`（第 59 行）与 `excavator-prd-report`（第 60 行）。

### 文档审读

- 新 `description` 以「每个功能的 PRD 章节与 findings 写进输出目录、拼装一份 `PRD.md`」开头，与单篇版「从知识图谱生成一篇 PRD」可区分。
- `docs/deploy.md`：示例命令的 `--scope`、`--language`、`--out`、`--concurrency` 都是新 skill 的选项；产物说明（`index.json`、每功能一章一份 findings、验证报告、`PRD.md`、只写 `--out`、不跑 `/excavator`、`--fresh`）与新 `SKILL.md` 一致；耗时表 `/excavator-prd` 一行与 `33c1566d^1` 相同，描述的是单篇版。
- 发现 F1（轻微，不挡合并）：`README.md:129` 「Generate an As-Is PRD for a feature」是 `33c1566d^1` 原文，但紧挨 `README.md:132` 「… for every feature」后，读起来像单篇版只能写一个功能；单篇版不给 `--scope` 时写整个项目（`skills/excavator-prd/SKILL.md:125` 「`.` for the whole project」）。

F1 已修：`README.md` 单篇版的说明改为「为整个项目或用 `--scope` 限定的一块写一篇 As-Is PRD」，与 `SKILL.md` 的 `--scope` 说明一致。根目录 Markdown 按 AGENTS.md 只跑 `tests/refs/legacy-literals.test.mjs`：6/6 过。
