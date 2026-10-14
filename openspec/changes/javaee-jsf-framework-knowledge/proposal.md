## Why

框架知识的第一、二层（`FrameworkConfig` 与 `frameworks/<id>.md` 附录）今天在流水线里是断开的。

- 没有任何阶段确定性地检测框架。Lazy 与 Full 共用的事实构建（`lazy-analyze.mjs`）写入图头的 `project.frameworks` 只会沿用旧图的值，旧图没有时就是 `[]`。验收语料现有的 13 份产物，图头全部是 `"frameworks": []`。
- Core 的 `FrameworkRegistry.detectFrameworks` 存在，但没有调用方。它每个 manifest 名只看第一个匹配文件，多模块仓库会漏检。它按子串匹配，注释与 Maven `<exclusions>` 里的字样也会命中。
- 附录的读者靠「检测到的框架」来选文件：Full 模式的 Phase F2（file-analyzer）与 F3 / Phase 4（architecture-analyzer）。Phase F 不再派发 LLM 项目扫描，于是这个来源是空的，附录实际上从未被注入。
- Java EE / Jakarta EE 与 JSF 既没有 `FrameworkConfig`，也没有附录。`.xhtml`（Facelets）、`.jsp` 一族文件不在扫描语言表里，按兜底规则被归为 `code`。

需求 R1（JSF / Facelets）与 R2（Java EE）的确定性部分已由前几步完成：名字提及 `mentions`、EL `references`、XML 与注解 `injects`。缺的就是这一层：检测出框架，把约定作为 guidance 送到分析模型面前。

## What Changes

- **确定性框架检测（通用，Core）**：
  - `FrameworkRegistry` 新增带证据的检测：每个 manifest 名的所有匹配文件都参与。每个检出的框架给出命中的 manifest 个数，以及第一处证据（路径、行、关键字），路径按稳定序。
  - 关键字只在「声明」里算数。按 manifest 的文件格式遮蔽注释与排除声明：
    - XML（`.xml`、`.csproj`）：`<!-- -->`，以及 `exclusions` / `exclude` / `excludes` 元素；
    - Gradle 与 `go.mod`：`//`、`/* */` 注释，以及 `exclude` 语句；
    - `#` 注释格式（`requirements.txt`、`Pipfile`、`pyproject.toml`、`setup.cfg`、`setup.py`、`Gemfile`）：`#` 到行尾。

    遮蔽只会减少命中，不会增加。
  - 旧的 `detectFrameworks` 改为委托新检测，签名不变。
  - 框架仍然只是数据，没有任何框架专属的检测代码。
- **扫描输出检测结果**：`scan-project.mjs` 对已选中并扫描的 manifest 做检测，输出 `detectedFrameworks: [{ id, manifests, evidence: { path, line, keyword } }]`，按 `id` 排序。
- **图头写入检测结果**：事实构建把 `project.frameworks` 写成检出的 id 列表，每次运行重算，不沿用旧图。`PIPELINE_VERSION` 升到 `lazy-fact-graph/10`，让已有产物刷新图头。
- **附录按 id 注入**：
  - SKILL.md 的 Phase 4 第 3 步（Phase F3 共用）改为按图头 `project.frameworks` 逐个读取 `frameworks/<id>.md`。
  - Phase F2 的派发提示补上 `Frameworks detected:` 一行，让 file-analyzer 的 Framework Guidance 有输入。
  - `frameworks/README.md` 把命名规则写成「附录文件名就是 `FrameworkConfig` 的 `id`」。
  - 新增契约测试：每个注册的 `FrameworkConfig` 都有同名附录，每个附录都对应一个注册的 config，`promptSnippetPath` 都指向存在的附录。
- **`javaee` FrameworkConfig 与附录**：
  - 检测范围：Java EE / Jakarta EE 平台 API（`javaee-api`、`jakarta.jakartaee-api` 及其 web profile）、EJB、JAX-RS（含 `jsr311-api`）、CDI，以及 `ejb-jar.xml` 描述符本身。
  - 只依赖 Servlet、JPA 或 JMS 的项目不检出。
  - 附录 `javaee.md` 只作 guidance：
    - 角色与分层：session bean、MDB、JAX-RS resource、provider、interceptor、entity、producer、描述符。
    - 指出图里已有的确定性事实，不要重画：`injects`、`references`、`mentions`、`implements`。
    - 按类型注入「恰好一个实现才连、否则留空」，JAX-RS 路由的拼接，MDB 目的地，CDI 事件：这些关系一律 `inferred`、无 evidence。
- **`jsf` FrameworkConfig 与附录**：
  - 检测范围：`javax.faces` / `jakarta.faces`、`jsf-api` / `jsf-impl`、MyFaces、PrimeFaces、RichFaces、ICEfaces，以及 `faces-config.xml` 与声明了 `FacesServlet` 的 `web.xml`。
  - 附录 `jsf.md` 只作 guidance：
    - 页面、模板、复合组件、backing bean、converter / validator 的角色与分层。
    - 已有事实：EL `references`；`template=`、`ui:include`、`ui:decorate` 与导航规则 view id 的 `mentions`。
    - action outcome 与隐式导航「恰好一个页面匹配才连」，复合组件标签到 `resources/<library>/<name>.xhtml`。
    - 组件库标签（`h:`、`f:`、`p:`、`rich:` 等）不透明，不连边。
- **视图文件按 markup 普查**：
  - `.xhtml`、`.jsp`、`.jspx`、`.jspf`、`.tag`、`.tagx` 声明为扫描语言、归 `markup`；`.tld` 归 `config`。语言 id 与今天的兜底值相同，名字提及的语法模式不变。
  - Core 语言注册表新增 `xhtml`。
- **Java EE 描述符的提及有夹具锁定**：`ejb-jar.xml`（`ejb-class`、业务接口、`interceptor-class`）与 `persistence.xml`（`class`）里的类名经既有的通用规则生成 `mentions` 边。今天没有夹具与测试，本步补上。

不在本步：

- JAX-RS 与 Spring MVC 注解路由的确定性目录（整族一起，另起变更）；
- JSF 导航 outcome 与页面到页面的确定性边；
- `layerHints` 接入分层（今天没有任何框架的 `layerHints` 被消费）；
- Full 模式的规模化运行与模型评估（R3）。

## Capabilities

### New Capabilities

- `framework-detection`：从被扫描的 manifest 确定性检测框架。所有匹配文件都参与，注释与排除声明不算，结果带证据；写入图头 `project.frameworks`；附录按 `FrameworkConfig` id 命名，并由图头驱动注入。
- `javaee-framework`：`javaee` 的检测范围与分层提示；`javaee.md` 只作 guidance；Java EE 描述符里的类名经 `mentions` 连边。
- `jsf-framework`：`jsf` 的检测范围与分层提示；`jsf.md` 只作 guidance；Facelets 与 JSP 视图文件按 markup 普查。

### Modified Capabilities

（无。本步不改既有能力的需求；`mentions` 规则不变，只补夹具。）

## Impact

- **Core**：
  - `packages/core/src/languages/framework-registry.ts`：带证据的检测，`detectFrameworks` 改为委托。
  - 新增 manifest 遮蔽模块。
  - `frameworks/javaee.ts`、`frameworks/jsf.ts` 及注册。
  - `configs/xhtml.ts` 及注册。
  - 对应测试，以及内建框架数量的测试期望（12→14）。
- **Skill 脚本**：
  - `scan-project.mjs`：语言与类别表、`detectedFrameworks`。
  - `lazy-analyze.mjs`：图头 `frameworks`，`PIPELINE_VERSION` `/10`。
- **Skill 散文**：
  - `SKILL.md`：Phase 4 第 3 步、Phase F2 派发提示。
  - `frameworks/README.md`、新附录 `frameworks/javaee.md` 与 `frameworks/jsf.md`。
  - `agents/excavator-project-scanner.md` 的类别表（视图文件归 `markup`）。
- **测试**：
  - 新夹具 `tests/fixtures/javaee-jsf-app/`；
  - 扫描、Lazy 图头与 mentions 的管线测试；
  - 散文契约测试。
- **产物**：
  - 图头 `frameworks` 从 `[]` 变为检出的 id；
  - `pipelineVersion` 变化使已有产物刷新一次；
  - 事实（节点、边、`factsDigest`）预期不变，由验收逐语料核对。
- **不触及**：VM、AWS、任何真实项目产物入库。
