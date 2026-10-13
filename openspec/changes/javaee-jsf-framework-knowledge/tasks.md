执行约束：
- 人员：一个 coder（Sonnet），一个 acceptor（Opus）。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试、注释与 skill 散文用英文，OpenSpec 用中文。
- build-free：不编译目标项目、不安装运行时、不下载依赖。
- 公开仓库：夹具、测试、附录与提交信息里不出现任何真实客户、产品或私有语料的名字。
- 分支：`feat/javaee-jsf-framework-knowledge` 基于 `main`，上一步已归档。
- 本变更改 Core：每次改完 Core 都要重建 core dist，再跑 skill 测试。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive annotation-injection-references`（已完成）。
1. `docs(openspec): propose javaee-jsf-framework-knowledge`：proposal、design、规格增量、tasks。
2. `feat(core): detect frameworks from every manifest with evidence`：任务 1.1–1.3。
3. `feat(core): javaee and jsf framework configs and the xhtml language`：任务 2.1–2.2。
4. `feat(scan): report detected frameworks and census view files as markup`：任务 3.1–3.3。
5. `feat(lazy): write detected framework ids into the graph header`：任务 4.1–4.3。
6. `docs(skill): javaee and jsf addenda injected by framework id`：任务 5.1–5.3。
7. `docs(openspec): record javaee-jsf-framework-knowledge acceptance`：任务 6.1–6.2。

## 1. Core：带证据的检测

- [x] 1.1 新增 `packages/core/src/languages/manifest-mask.ts`，导出 `maskManifestText(path, text)`，按 design D2 的格式表遮蔽。被遮蔽的字符换成空格，换行保留。
  验证：core 单元测试逐格式断言：
  - XML：注释、未闭合注释、`exclusions` 成对元素、`exclude` 自闭合、`excludes`、大小写变体、缺结束标签时不遮蔽；
  - Gradle：`//`、`/* */`、行内 `exclude group:`；
  - Gradle 单行字符串：`'**/*.java'`、`"http://…"`、`'exclude'` 不开注释或排除；转义引号；未闭合引号不算字符串；
  - `go.mod`：`exclude` 行与 `exclude ( … )` 块；
  - `#` 注释格式，以及字符串里的 `#` 不算注释；
  - `package.json` 原样返回。

  每个用例同时断言输出长度与换行位置等于输入。
- [x] 1.2 `FrameworkRegistry` 新增 `detectWithEvidence(files)`，按 design D1；`detectFrameworks` 改为委托，签名与注册顺序不变。
  验证：core 单元测试覆盖 spec `framework-detection` 前两条需求的每个场景：
  - 子模块检出；
  - 多文件取稳定序第一个；
  - 没有命中；
  - Maven 排除；
  - 注释；
  - Gradle 排除；
  - 注释外的声明且行号不偏移。

  另加：
  - 同一位置两个关键字平手按配置顺序；
  - 输入顺序打乱结果不变；
  - 既有 `detectFrameworks` 测试全部不改仍绿。
- [x] 1.3 重建 core dist；core 测试、typecheck、根测试全绿。
  验证：命令输出计数写进交付报告。

## 2. Core：配置与语言

- [x] 2.1 新增 `frameworks/javaee.ts`、`frameworks/jsf.ts`，字段按 design D6，`promptSnippetPath` 为 `./frameworks/<id>.md`，在 `frameworks/index.ts` 的数组与导出两处注册。新增 `configs/xhtml.ts`（id `xhtml`，扩展名 `.xhtml`，无 tree-sitter）并注册。
  验证：core 测试覆盖：
  - 内建框架数 12→14；
  - spec `javaee-framework` 与 `jsf-framework` 第一条需求的每个场景（用 `detectWithEvidence` 与内存中的 manifest）；
  - 两个配置的 `layerHints` 至少含 spec 列出的映射，`entryPoints` 含 spec 列出的项；
  - 语言注册表按 `.xhtml` 找到 `xhtml`，且它没有 tree-sitter 配置。
- [x] 2.2 重建 core dist；core 测试、typecheck、根测试全绿。核对 `text-mentions.mjs` 的 `isCodeLanguage('xhtml')` 仍为假，既有名字提及与 EL 引用的管线测试不改仍绿。
  验证：命令输出计数写进交付报告。

## 3. 扫描

- [x] 3.1 `scan-project.mjs` 按 design D7 扩充语言表与类别表；`agents/excavator-project-scanner.md` 的类别表同步。
  验证：`tests/skill/excavator/test_scan_project.test.mjs` 断言七个扩展名的语言 id 与类别（spec「Facelets 与 JSP 视图按 markup 普查」的前两个场景及其余扩展名），以及 `classifyLanguage` 对它们报 `declared: true`。
- [x] 3.2 `scan-project.mjs` 按 design D3 输出 `detectedFrameworks`，更新文件头注释的输出示例。
  验证：扫描测试覆盖：
  - 检出的精确值（id、manifest 数、证据路径与行）；
  - 被 `.excavatorignore` 排除的 manifest 不参与（spec 场景「被忽略的 manifest 不参与」）；
  - 默认过滤目录（如 `node_modules/`、`target/`）里的 manifest 不参与；
  - 没有 manifest 时为 `[]`；
  - 同一输入两次扫描输出逐字节相同。
- [x] 3.3 新增夹具 `tests/fixtures/javaee-jsf-app/`，按 design D9。扫描测试对它断言 `detectedFrameworks` 恰为 `javaee`（manifest 数 2）与 `jsf`（manifest 数 3），没有 `spring`；断言视图文件的语言与类别。
  验证：测试通过；临时让 `maskManifestText` 原样返回，确认 `spring` 出现、测试变红，再还原。

## 4. 图头

- [x] 4.1 `lazy-analyze.mjs` 按 design D4 写 `project.frameworks`，扫描结果缺 `detectedFrameworks` 时抛错；`PIPELINE_VERSION` 升到 `lazy-fact-graph/10`，同步更新只断言版本字符串的既有测试。
  验证：`tests/lazy/` 新增管线测试，覆盖 spec「检测结果写入图头」的场景：
  - 对夹具首次运行，图头为 `["javaee", "jsf"]`；
  - 预置一个图头为 `["Spring Boot"]` 的旧图，再运行后被替换为检出值；
  - 夹具去掉全部关键字后为 `[]`。
- [x] 4.2 用同一夹具锁定 Java EE 描述符的提及，按 spec「Java EE 描述符里的类名经 mentions 连边」。
  验证：管线测试断言精确的 `mentions` 边列表与证据行：
  - `ejb-jar.xml` 到 bean 类、业务接口、拦截器；
  - `persistence.xml` 到实体；
  - `web.xml` 到夹具里的 servlet、filter、listener（若有）；

  并断言 `provider` 计入仓库外、不成边。
- [x] 4.3 核对既有 Lazy 夹具的管线测试：凡夹具里有 manifest 的，图头的 `frameworks` 变化逐个列出并更新期望；冻结摘要若受影响，用生成器整块重冻并列出；`factsDigest` 不得因本步变化。
  验证：根测试全绿；交付报告列出每个更新了期望的测试及原因。

## 5. 附录与注入

- [x] 5.1 新增 `skills/excavator/frameworks/javaee.md` 与 `jsf.md`，按 design D8 与两份 spec 的「SHALL 写明」逐条落段落。
  验证：散文契约测试断言两份附录含以下各点的关键语句，并且不含行号模式（如 `:\d+`）：
  - 「Already in the fact graph」一节及其边类型；
  - 每条推断规则的「零个或多个候选不连」；
  - 组件库标签不透明（jsf）；
  - `inferred` 与无 evidence。
- [x] 5.2 `SKILL.md` 的 Phase 4 第 3 步与「Additional context」、Phase F2 派发提示，按 design D5 改为取图头 `project.frameworks`；`frameworks/README.md` 的命名一节、「What is where today」表与「Present today」列表更新。
  验证：散文契约测试断言：
  - SKILL.md 两处含 `project.frameworks`；
  - README 写明文件名即 `FrameworkConfig` 的 `id`，并列出 `javaee.md`、`jsf.md`；
  - 既有的 framework guidance 契约测试按新措辞更新后仍绿。
- [x] 5.3 新增配置与附录的双向契约测试，按 spec「附录按框架配置 id 命名并由图头驱动注入」的第一个场景。
  验证：测试读 core dist 的 `builtinFrameworkConfigs`，断言 id 集合等于附录文件名集合，每个 `promptSnippetPath` 等于 `./frameworks/<id>.md`；临时注册一个无附录的 id 时测试变红（在测试内用变异副本证明，不改产品代码）。

## 6. 验收与门禁

- [ ] 6.1 acceptor 按 design「验收 Oracle」O2–O8 在 13 个语料上执行，产物与脚本留在仓库外的验收工作区，不提交任何真实项目产物；D10 的变异由 coder 报告、acceptor 复核。
  验证：每个 oracle 给出 PASS / FAIL、计数与证据路径；编造计数为 0；漏检逐条归因。
- [ ] 6.2 全量门（O9）通过后，把验收摘要写进本文件末尾。
  验证：门禁命令与计数写入摘要；`openspec validate --all --strict` 通过；提交前 grep 客户信息为零命中。
