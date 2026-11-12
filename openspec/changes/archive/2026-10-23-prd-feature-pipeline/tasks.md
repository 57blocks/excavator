## Commit 序列

0. `docs(openspec): propose prd-feature-pipeline`：本变更的四个文件。
1. `feat(prd): list entrypoint candidates from a pattern catalog`（1.1–1.3）。
2. `feat(prd): index conservation and lane checks`（2.1–2.3；2.4 的契约测试与 commit 4 同入，以保每个 commit 单独过门）。
2b. `fix(prd): check every candidate anchor and take the root from the caller`（验收第一轮的修复：design D11、按位置解析核对回复、Express 两行窗口、建议词表收窄、`mark` 子命令）。
3. `feat(prd): aggregate the lanes and assemble one PRD`（3.1–3.3）。
4. `feat(prd): overview, concurrent feature lanes and resume`（4.1–4.5，含 2.4 的契约测试）。
4b. `fix(prd): check the index on resume and keep lane files untouched`（验收第二轮：design D12、续跑先 `check-index`、`check-lane` 自记结果、`mark failed` 只剩 lane 步、模式候选文本核对、保存提议行条件化）。
4c. `fix(prd): print the reply by script and guard the index against races`（O4 后：design D9 改为 `reply` 子命令、建议词门放过源专名、`index.json` 排他锁、模式候选须等于 `entrypoints.json`、续跑不重建索引、泳道末行自检）。
4d. `fix(prd): say what to do with a stale index lock`（评审观察项：过期锁的处理规则进 SKILL 与锁超时信息）。
4e. `fix(prd): name the backtick rule in the anchor message`（最终复跑观察：两次重试因锚点没加反引号失败，检查信息与泳道提示词写明规则；重试提示词须带全部检查行）。
5. `docs(openspec): record prd-feature-pipeline acceptance and archive`（5.1–5.4）。

每个代码 commit 自带测试；commit 4 之后跑 design O3 冒烟，合并前跑 O4 与 O5。所有脚本与 SKILL.md 英文、源码零中文字符；夹具只用合成项目。

## 1. 入口候选

- [x] 1.1 `skills/excavator-prd/entrypoint-catalog.json`：express（`router.<verb>(`、`app.<verb>(`）、gin（`.<VERB>(`、`.Any(`）、react-router（router 目录里的 `path:`、`<Route`）、go cron（`AddFunc(`）、node-schedule（`scheduleJob(`）、`main(` 的模式，每条带 `kind` 与可选 `pathHint`。验证：JSON 可解析，每个模式是合法正则（测试逐条 `new RegExp`）。
- [x] 1.2 `skills/excavator-prd/prd.mjs entrypoints <projectRoot> [--scope <subdir>]`：按事实图头部 `frameworks`（无图时按构建文件：`package.json` 依赖、`go.mod` require）选模式，扫描源码（跳过 `.git`、`.excavator`、`node_modules`、测试文件按名后缀），输出候选 JSON 到 stdout：`{frameworks, covered, uncovered, items}`。验证：三个合成夹具（express、gin、react-router）各列出已知条数与 `file:line`；一个只含未知框架的夹具 `uncovered` 非空、`items` 为空；`--scope` 只列子目录内的。
- [x] 1.3 README 与 `docs/deploy.md` 里 `/excavator-prd` 的描述改为目录产物与并发。验证：`node scripts/check-refs.mjs`。

## 2. 索引与泳道检查

- [x] 2.1 `prd.mjs check-index <out>`：design D2 的 schema 校验与两条守恒；`inferred` 候选的文件与行号存在；`seedFiles` 收敛到项目根内。验证：先验装置——合法 index 绿；删掉一个候选的归属红并打印 id；同一候选归两个功能红；`inferred` 候选行号超出红。
- [x] 2.2 `prd.mjs check-lane <out> <id>`：front-matter、mermaid、`<details>` 证据块、锚点收敛与行号、findings schema、引文恰好一次并写回 `line`、建议性措辞门（英文与 `\u` 转义的中文模式）。验证：design O1 的五个坏夹具各红并打印原因；合法夹具绿且写回的 `line` 等于已知行；空 findings 数组绿。
- [x] 2.3 引文归一化与 doc-map 一致（NFKC、去不可见字符、折叠引号与破折号、合并空白、保留大小写）；放在 `prd.mjs` 内部或共享模块，不改 `doc-map.py`。验证：含全角引号的引文命中。
- [x] 2.4 `tests/skill/test_prd_skill_contract.test.mjs` 先改成目标状态的断言（design O2），此时对旧 SKILL.md 应当红。验证：测试文件能加载，断言对旧文本失败。

## 3. 汇总与拼装

- [x] 3.1 `prd.mjs aggregate <out>`：按文件存在与 `check-lane` 结果重算状态；解析 `verification/<id>.txt` 的固定行（`Statements: ...`、`Open items: ...`、`Cross-section conflicts: ...`、`Corrections applied: ...`），解析失败标 `failed`；合并 `findings.json`（带 `feature`、`verdict: anchor-checked`）；生成 `tables/roles-by-feature.md`、`tables/coverage.md`、`tables/verification.md`；检查状态桶守恒；stdout 打印 design D9 需要的字段 JSON。验证：桶之和等于功能数；缺一行时该功能 `failed`；合计等于各功能计数之和（夹具里故意让某功能计数为 0 以证明不是数功能数）。
- [x] 3.2 `prd.mjs assemble <out>`：按 `chapter` 拼装（design D7），去 front-matter，附录含 `failed` 功能。验证：两次字节相同；`failed` 功能出现在附录、不在正文。
- [x] 3.3 `prd.mjs` 的 `--help` 与错误信息；`<out>` 不存在时各子命令的退出码与提示。验证：单测。

## 4. SKILL.md 重写

- [x] 4.1 Phase 0 设置：解析 `path`、`--role`、`--language`、`--scope`、`--out`（默认 `<root>/.excavator/prd/`）、`--concurrency`（默认 3）、`--fresh`；新鲜度只提示不重建（design D8）；续跑判定（design D6）。验证：契约测试钉住默认值、「不运行 /excavator」字样与续跑规则。
- [x] 4.2 Phase 1 总览与索引：跑 `entrypoints`，模型分组成功能并写范围声明（可参考 `domain-graph.json` 的 flow 名，守恒只对候选）、起草术语表，写 `index.json`，跑 `check-index`，打印功能清单。保留现有 1b 的离图行为搜寻（通知、定时、权限、外部服务、配置）作为补候选的来源，补的标 `inferred`。验证：契约测试钉住 `check-index` 在派泳道之前。
- [x] 4.3 Phase 2 泳道：内联的子代理提示词（功能 id、范围、术语表、`$LANGUAGE`、`--role`、现有写作规则全文、findings 的两类定义与「不写修法」、只写两个文件、回复一行）；按批派发、前台等待、返回即 `check-lane`、缺文件重派一次（design D3、D4）。验证：契约测试钉住并发默认 3、「前台」字样、重派一次。
- [x] 4.4 Phase 3 核对与汇总：对每个 `checked` 功能按 `excavator-verify` 流程跑 `--fix`，报告到 `verification/<id>.md`，回复的固定行存到 `verification/<id>.txt`；写 `overview.md`（范围大小按现有命令统计）；跑 `aggregate` 与 `assemble`。验证：契约测试钉住 verify 由编排者执行、`overview.md` 不含表格字样的要求。
- [x] 4.5 Phase 4 自检与回复：由 `aggregate` 的 stdout 填 printf（design D9）；`$LANGUAGE` 段落位置与现有测试一致。验证：契约测试的回复断言；`tests/skill/test_verify_skill_contract.test.mjs` 里引用 prd 的断言仍过。

## 5. 验收与归档

- [x] 5.1 O3 冒烟：`--scope go-multirepo-auth --out <scratch>`，记录功能数、状态分布、findings 计数、`uncovered`、耗时与 `total_cost_usd`；运行前后 go-multirepo `.excavator/` 清单与 mtime 比对为空。
- [x] 5.2 O5 中断续跑：按 design O5 执行并记录。
- [x] 5.3 O4 全量关口（按 design 验收记录：改为限定 go-multirepo-review 成员；整语料全量推迟）：不带 `--scope`、`--concurrency 3`；记录同上；findings 分层抽 10 条读证据；与 `domain-graph.json` 的 flow 名重叠计数。
- [ ] 5.4 把 5.1–5.3 的脱敏摘要（代号、计数、digest、耗时、费用）写进 design.md 的「验收记录」，同步 spec，归档。
