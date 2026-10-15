执行约束：
- 人员：一个 coder，一个 acceptor（Opus），同时开始。acceptor 在 coder 写代码时先做预注册、基线与独立核对脚本。
- 验收 oracle 见 design.md「验收 Oracle」，动手前已写死。
- 语言：代码、测试与注释用英文，OpenSpec 用中文。
- build-free：不编译目标项目，不安装运行时，不下载依赖。
- 分支：`feat/component-layers` 基于 `main`；`default-file-patterns` 已归档。
- 不改 Core（`packages/core`）。
- 公开仓库：夹具、测试与提交信息里不出现客户、产品或私有语料的名字。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入，每个 commit 单独可测）：

0. `docs(openspec): archive default-file-patterns`（已完成）。
1. `docs(openspec): propose component-layers`：proposal、design、规格增量、tasks。
2. `feat(skill): component role catalog`：任务 1.1。
3. `feat(skill): component roles and layers in the fact graph`：任务 1.2–1.4。
4. `feat(skill): layers in MCP traverse and recall`：任务 2.1。
5. `feat(skill): audit model layers against component roles`：任务 3.1–3.2。
6. `docs(openspec): record component-layers acceptance`：任务 4.1–4.2。

## 1. 角色事实

- [ ] 1.1 写 `skills/excavator/catalogs/component-roles.json` 与严格加载器 `component-role-catalog.mjs`，内容按 javaee-framework 与 jsf-framework 规格的角色表。按 design D9 写目录测试：
  - 每种加载失败一条；
  - `boundBy` 引用的绑定者在名字绑定目录里存在；
  - 每个角色的层出现在 Java EE 或 JSF 附录的层表里。

  验证：目录测试通过。
- [ ] 1.2 描述符读取（design D2）：
  - `xml-name-bindings.mjs` 加 `componentRolesOfTree`；
  - `name-reference-sites.mjs` 在同一趟读取里产出 `componentRoleDeclarations`；
  - `lazy-analyze.mjs` 加载角色目录并传入。

  验证：对夹具描述符的读取测试，覆盖每种描述符元素、没写类的元素与 EJB 2.x 无命名空间的根。
- [ ] 1.3 新建 `component-role-resolution.mjs`，接入 `build-fact-graph.mjs`：
  - 三种来源点；
  - 按 fact-graph 规格的桶与顺序；
  - design D3 的整段匹配；
  - 节点属性、覆盖、两种缺口、`assertComponentRoleConservation`；
  - `mutations` 测试缝。

  `PIPELINE_VERSION` 升到 `lazy-fact-graph/13`。

  验证：
  - 规格每个场景一条测试，每个桶至少一条；
  - 夹具补齐需要的类与描述符条目，既有测试的钉住值用生成器整块重冻，逐项写明原因；
  - design D9 的前五条绊线逐条变红，记下条数。
- [ ] 1.4 `validate-graph.mjs` 核对 `componentRoles` 证据。验证：证据可复核场景，以及行号改坏后报出证据不符。

## 2. MCP

- [ ] 2.1 `project-service.mjs`：`traverse` 的节点与 `recall` 的候选带 `layer` 与角色 id 列表（节点有时），原有字段不变。验证：经 MCP 看到层的场景；没有层的节点输出与改前相同。

## 3. Full 分层审计与附录

- [ ] 3.1 `semantic-graph.mjs write` 按 full-semantic-isolation 规格审计，只记缺口不改写。`SKILL.md` Phase F3 的事实节点带 `layer`，并写明它是事实。验证：
  - 规格三个场景各一条测试；
  - 文件里类节点分属不同层时不审计文件；
  - 绊线 `noAuditFiles` 变红。
- [ ] 3.2 `frameworks/javaee.md` 与 `frameworks/jsf.md`：
  - 写明 `layer` 与 `componentRoles` 是事实，不重新分配；
  - 补上同时是会话 bean 的 JAX-RS 资源与 servlet 在 `layer:api`；
  - 层表与目录一致。

  验证：1.1 的附录一致性测试与 `check-refs` 通过。

## 4. 验收与记录

- [ ] 4.1 acceptor 按 design「验收 Oracle」O2–O5 执行，报告放在 `excavator-test-runs/component-layers/`，不进仓库；O6 由我跑。
- [ ] 4.2 在本文件末尾写「验收摘要」：
  - 被测提交与基线；
  - O1–O6 的结果表；
  - 每个语料的角色计数与按层计数；
  - 已知限制。

  语料用公开名字，私有语料只写「一个私有 C# 语料」一类的说法。
