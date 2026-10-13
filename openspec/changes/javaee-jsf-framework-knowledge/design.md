## Context

- 框架知识分三层，见 `skills/excavator/frameworks/README.md`：
  1. `FrameworkConfig`：检测关键字、manifest 名、入口、分层提示，纯数据；
  2. `frameworks/<id>.md` 附录：给分析模型的约定；
  3. 声明式目录驱动的确定性事实。

  前几步把 R1 / R2 的第三层做完了：`mentions`、EL `references`、XML 与注解 `injects`。本步只动前两层，以及把它们接进流水线。
- 今天的断点，详见 proposal 的 Why：
  - `lazy-analyze.mjs` 写图头时 `frameworks: existingGraph?.project?.frameworks ?? []`；
  - Phase F 不派发 LLM 项目扫描；
  - SKILL.md Phase 4 第 3 步写的是「Phase 1 检出的框架」；
  - Phase F2 的派发提示不提框架。
- `FrameworkRegistry.detectFrameworks(manifests: Record<string, string>)`：
  - 对每个配置的每个 manifest 名，用 `Object.entries(...).find` 只取第一个匹配文件；
  - 关键字是小写子串匹配；
  - 没有调用方，只有单元测试。
- `scan-project.mjs`：
  - 读入每个被选中文件的字节，用于摘要与行数；
  - 语言表与类别表是脚本自己的（只有 TypeScript 与 Dockerfile 走 Core 注册表）；
  - 未声明的扩展名以去掉点的扩展名作语言 id、类别兜底为 `code`，抽取结果为 `no-extractor`。
- `text-mentions.mjs` 按语言 id 选择标记语法：`jsp`、`jspf`、`tag` 按 HTML 式，`jspx`、`tagx`、`xhtml` 按 XML 式。这些 id 今天都来自扩展名兜底。
- 探针。脚本在 scratchpad，只作量级参考，不是 oracle。对已有 12 个配置加上本步拟定的 `javaee` / `jsf` 关键字，看全部 manifest，按 D2 遮蔽：

  | 语料 | 检出 | 说明 |
  |---|---|---|
  | Seam 2.2 examples | javaee、jsf | Ant 项目，靠 `ejb-jar.xml`（28 个）与 `faces-config.xml`（91 个） |
  | TomEE 8.x examples | javaee、jsf、spring | `javaee-api` 205 个 pom；spring 来自 `spring-data` 示例 |
  | Cargo Tracker | javaee、jsf | `jakarta.jakartaee-api`、`primefaces` |
  | Dataverse | javaee、jsf、spring | spring 来自 `scripts/zipdownload` 子项目 |
  | OSCAR | spring | |
  | OpenMRS core | spring | |
  | Sakai 12.7 | jsf、spring | |
  | fineract | javaee、spring | javaee 来自 JAX-RS（`jakarta.ws.rs`） |
  | hadoop | javaee、react | javaee 来自 JAX-RS；react 来自 YARN 的 UI 子项目 |
  | 两个私有 Go 服务 | gin | |
  | 一个私有 MAUI 应用 | maui | |
  | 一个私有 Angular + Spring 应用 | angular、spring | |

  不遮蔽时只多出一处：hadoop 的 `spring`。唯一命中是 `hadoop-bos/pom.xml` 第 88 行的 `<exclusion>`，属于编造。
  - 被遮蔽的命中（注释与 `<exclusions>`）：Sakai 12.7 88 处、hadoop 29 处、OSCAR 4 处、Dataverse 3 处、TomEE examples 2 处、OpenMRS core 1 处。私有 Spring 应用另有 Gradle `exclude` 行 4 处。
  - 只看第一个 manifest（今天的语义）会漏检：Sakai 12.7 漏 `spring`，hadoop 全漏。

## Goals / Non-Goals

**Goals:**

- 框架检测成为确定性普查：
  - 所有 manifest 都参与；
  - 每个检出都带一处可复核的证据；
  - 注释与排除声明不算；
  - 结果写入图头，Full 模式的两个分析派发都从图头取。
- R1 / R2 要求的 `javaee`、`jsf` 配置与附录到位。附录把模型引向已有的确定性事实，只在「恰好一个候选」时推断。
- 视图文件按 markup 普查，名字提及与 EL 引用的行为逐条不变。

**Non-Goals:**

- 不按 manifest 格式解析依赖坐标。关键字仍是子串，只做遮蔽。理由见 D2。
- 不接入 `layerHints`：今天没有任何读者，接入属于 Full 分层的规模化工作（R3）。
- 不改 `project_status` 等 MCP 工具的返回形状：检测结果经图头对读图的消费者可见。
- 不做注解路由目录、JSF 导航 outcome 的确定性边。这两件是下一步。
- 不改既有 12 个配置的关键字，只改它们的匹配范围（全部 manifest）与遮蔽。验收逐语料列出由此产生的检出变化。

## Decisions

**D0：为什么检测落代码，而不是交给模型。**

- 检测是对整个仓库 manifest 的普查。漏检、误检都要能对着文件复核，这正是确定性抽取该做的事。
- Phase F 已不派发 LLM 扫描。今天模型读不到 manifest，也就无从检测。
- 名字由 id 决定，附录按 id 取文件。模型写 `Spring Boot`、`Jakarta EE` 这类显示名，对不上 `spring.md`、`javaee.md`。

**D1：Core 的检测接口。**

```ts
interface FrameworkDetection {
  id: string;
  manifests: number;                        // 有命中的 manifest 文件数
  evidence: { path: string; line: number; keyword: string };
}
// FrameworkRegistry
detectWithEvidence(files: Array<{ path: string; content: string }>): FrameworkDetection[];
```

- 输入顺序无关。引擎先按路径的 UTF-16 码元序排序（与 `scan-project.mjs` 的 `compareStableStrings` 同序，不用 `localeCompare`）。
- 对每个配置，遍历全部文件；文件名匹配规则沿用今天的「精确名或 `/` 后缀，`*.ext` 按后缀」。
- 在遮蔽后的小写文本里找每个关键字的最早位置。一个文件的命中位置取所有关键字里最早的那个；同一位置的平手按配置里的关键字顺序。行号由原文偏移换算（遮蔽不改换行，见 D2）。
- 结果按 `id` 排序。
- `detectFrameworks(manifests: Record<string, string>)` 保留签名：转成数组调 `detectWithEvidence`，再按注册顺序映射回配置对象。既有测试的期望不变。

**D2：按 manifest 格式遮蔽，而不是解析依赖坐标。**

- 新模块 `manifest-mask.ts`，导出 `maskManifestText(path, text): string`。被遮蔽的字符换成空格，换行保留，因此偏移与行号不变。
- 格式按文件名决定：
  - `*.xml`、`*.csproj` 为 XML：
    - `<!--` 到 `-->`，未闭合时到文件尾，与 `text-mentions.mjs` 的注释规则一致；
    - 名为 `exclusions`、`exclude`、`excludes` 的元素，不区分大小写。自闭合形式整体遮蔽；成对形式从开始标签遮到最近的同名结束标签，结束标签缺失就不遮蔽。
  - `*.gradle`、`*.gradle.kts`、`go.mod` 为 C 风格：
    - `/*` 到 `*/`，未闭合时到文件尾；
    - `//` 到行尾；
    - 独立单词 `exclude` 到行尾；
    - `go.mod` 的 `exclude (` 到下一个 `)`。
  - `requirements.txt`、`Pipfile`、`pyproject.toml`、`setup.cfg`、`setup.py`、`Gemfile`：`#` 到行尾。
  - 其余（`package.json`、`angular.json` 等）原样返回。
- 只遮蔽、不增补，所以遮蔽只会让命中变少。最坏情况是漏检，而漏检在验收里可见。例如字符串里的 `//` 把同一行后面的声明遮掉。
- 考虑过的替代：
  - **单词边界匹配**：探针里没有拦下任何一处误检，却会改变既有关键字（`"next":`、`@angular/core`）的语义。不采用。
  - **按格式解析依赖坐标**（pom 的 `dependency`、`package.json` 的依赖键）：要把 12 个配置的关键字全部改写成坐标，改动扩散到所有框架。本步只需要拦住注释与排除。不采用，以后若要进一步收紧再单独提出。
  - **不遮蔽**：hadoop 会因一条 `<exclusion>` 检出 `spring`，是编造。不采用。

**D3：扫描接入。**

- 扫描循环里，对通过全部跳过检查、即将写入 `files` 的文件，若文件名匹配任一已注册配置的 manifest 名，就保留 `{ path, content }`。内容由已读入的字节按 UTF-8 解码，不另读盘。
- 循环结束后调 `FrameworkRegistry.createDefault().detectWithEvidence(...)`，写入输出的 `detectedFrameworks`。该字段总是存在，没有检出时是 `[]`。
- 被忽略、默认过滤、敏感、过大、二进制、读取失败的文件不在 `files` 里，自然不参与。
- 文件头注释的输出示例补上该字段。

**D4：图头。**

- `lazy-analyze.mjs` 写 `frameworks: scan.detectedFrameworks.map((d) => d.id)`，不再沿用旧图。
  - 框架从「叙述」变成「事实」。
  - 沿用会把过时的检测冻结在图头。
  - 旧图里的显示名（若有）从来没有读者：Phase F 不读，附录按 id 取文件。
- 扫描结果缺 `detectedFrameworks` 时抛错。扫描脚本与驱动同版本发布，缺字段说明装配坏了，不能静默写 `[]`。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/10`。版本号参与新鲜度判定（`sync-fact-graph.mjs`、`project-service.mjs`），不升的话，源码未变的已有产物永远停在 `"frameworks": []`。
- 证据在数据目录的 `intermediate/scan-result.json` 里，随每次运行覆盖。不进图头：`ProjectMeta.frameworks` 的形状 `string[]` 不变，读者不受影响。

**D5：附录注入改为按图头 id。**

- SKILL.md Phase 4 第 3 步（Phase F3 声明与之相同）改为：
  - 读图头的 `project.frameworks`（`knowledge-graph-store.mjs header` 可取）；
  - 对每个 id 读 `./frameworks/<id>.md`，追加全文；
  - 不存在就静默跳过。
  - 「Additional context」里的 `Frameworks detected:` 同样取自图头。
- Phase F2 派发提示加一行 `> Frameworks detected: <project.frameworks from the graph header>`。file-analyzer 的 Framework Guidance 一节本来就按「派发提示报出的框架」自读附录，不需要改。
- `frameworks/README.md` 的命名一节改为：附录文件名就是 `FrameworkConfig` 的 `id` 加 `.md`；事实构建把检出的 id 写进图头，两个读者都按它取文件。既有契约测试断言的短语 `lower-cased framework id` 随之更新。
- 新增契约测试，位置在既有的 `test_prompt_evidence_sections.test.mjs` 或同目录新文件：
  - 注册的 config id 集合等于附录文件名集合（去掉 `.md`，不含 `README.md`）；
  - 每个 `promptSnippetPath` 都是 `./frameworks/<id>.md`；
  - SKILL.md 的 Phase 4 第 3 步与 F2 派发提示都含 `project.frameworks`。
- 散文改动用英文，与 skill 其余部分一致。

**D6：两个配置。**

| 字段 | `javaee` | `jsf` |
|---|---|---|
| `displayName` | `Java EE / Jakarta EE` | `JavaServer Faces` |
| `languages` | `["java", "kotlin"]` | `["java"]` |
| `manifestFiles` | `pom.xml`、`build.gradle`、`build.gradle.kts`、`ivy.xml`、`ejb-jar.xml` | `pom.xml`、`build.gradle`、`build.gradle.kts`、`ivy.xml`、`faces-config.xml`、`web.xml` |
| `detectionKeywords` | 见 spec「从 manifest 与 EJB 描述符检测 javaee」 | 见 spec「从 manifest 与 JSF 描述符检测 jsf」 |
| `entryPoints` | `**/WEB-INF/web.xml`、`**/META-INF/ejb-jar.xml`、`**/META-INF/application.xml` | `**/WEB-INF/faces-config.xml` |
| `layerHints` | `ejb→service`、`service→service`、`rest→api`、`resource→api`、`entity→data`、`model→data`、`dao→data`、`interceptor→middleware`、`filter→middleware` | `webapp→ui`、`pages→ui`、`views→ui`、`beans→ui`、`converter→utility`、`validator→utility` |

- 关键字的取舍：
  - Servlet、JPA、JMS 在 Spring 与普通 Java 项目里同样常见，作为 `javaee` 的关键字会把附录送给不相干的项目。
  - JAX-RS 留在里面：用到它的项目（fineract、hadoop）确有 `@Path` resource，附录的 JAX-RS 一节对它们适用。
  - `ejb-jar` 与 `faces-config` 让没有 Maven / Gradle 的 Ant 项目（Seam examples）也能检出。
- `layerHints` 不用 `resources`：Maven 的 `src/main/resources` 会被误当成 JAX-RS 层。

**D7：视图文件普查。**

- `scan-project.mjs` 的语言表加 `.xhtml`、`.jsp`、`.jspx`、`.jspf`、`.tag`、`.tagx`、`.tld`，id 与今天的兜底值逐个相同。
- 类别表：`.tld` 归 `config`，其余归 `markup`。
- Core 新增 `configs/xhtml.ts`（id `xhtml`、扩展名 `.xhtml`、无 tree-sitter）并注册。
  - JSP 一族不进 Core 注册表：它们的 id 各不相同、语法模式不同，合成一个 `jsp` 语言会改变名字提及的解析。
  - 只在扫描表里声明，与 `vue`、`gradle`、`properties` 等今天的做法一致。
- `agents/excavator-project-scanner.md` 的类别表同步。
- 影响面：
  - 这些文件的抽取结果仍是 `no-extractor`；
  - 导入图对非 `code` 文件给空数组，与今天没有解析器时相同；
  - 只有遗留 Phase 2 的分批（`compute-batches.mjs`）把它们从代码批移到非代码批。

**D8：附录内容。**

- 结构照 `angular.md`：文件角色表、边的模式、分层表、`languageLesson` 要点、「约定不是证据」。
- 两份附录在边的模式之前都有一节「Already in the fact graph」，逐条列出确定性边的类型与来源，明令不重画。
- 所有推断规则都写成「恰好一个候选才连，否则不连并说明」，不给模型留猜的空间。
- 不写行号，不写 evidence，不出现任何真实项目名。

**D9：夹具 `tests/fixtures/javaee-jsf-app/`。**

- 两个 Maven 模块：
  - 根 `pom.xml` 是聚合 pom，其 `<exclusions>` 里写 `org.springframework`，用来证明遮蔽；
  - `orders-ejb/pom.xml` 声明 `jakarta.jakartaee-api`；
  - `orders-web/pom.xml` 声明 `primefaces`。
- `orders-ejb`：
  - `META-INF/ejb-jar.xml`：`ejb-class`、`business-local`、`interceptor-class`；
  - `META-INF/persistence.xml`：`class` 与仓库外的 `provider`；
  - 对应的 Java 类。
- `orders-web`：
  - `WEB-INF/web.xml`，声明 `FacesServlet`；
  - `WEB-INF/faces-config.xml`；
  - `.xhtml` 页面、`.jsp`、`.jspf`、`.tag`、`.tld` 各至少一个。
- 用于：
  - 扫描测试：`detectedFrameworks` 的精确值，以及视图文件的语言与类别；
  - Lazy 管线测试：图头 `["javaee", "jsf"]`、描述符的 `mentions` 边、仓库外计数；
  - 跨文件的检测场景。
- 单文件的遮蔽场景放在 Core 单元测试里逐格式覆盖。

**D10：变异绊线。** 下列每个变异至少让一条测试变红：

1. 回到只看第一个匹配的 manifest；
2. 去掉 XML 注释遮蔽；
3. 去掉 `exclusions` 元素遮蔽；
4. 去掉 Gradle `exclude` 遮蔽；
5. 遮蔽吞掉换行（行号偏移）；
6. 证据不按路径稳定序取第一个；
7. 图头沿用旧图的 `frameworks`；
8. 不升 `PIPELINE_VERSION`；
9. 删掉某个附录或某个配置的注册；
10. `.jspf` 的语言 id 改成 `jsp`。

coder 逐个手工施加、确认变红、还原，并在报告里列出变红的测试。

## 验收 Oracle

语料与上一步验收相同，检出不动。acceptor 记录每个语料的 HEAD。上一步留下的 `lazy-fact-graph/9` 产物作为基线。

- **O1 夹具与绊线**（coder 写，acceptor 审）：
  - 规格的每个场景一条测试；
  - D10 的每个变异至少一条测试变红。
- **O2 检测零编造**（acceptor 独立实现，不复用被测代码）：
  - 按 spec 独立实现遮蔽与匹配；
  - 对 13 个语料逐一比较 `intermediate/scan-result.json` 的 `detectedFrameworks`：id 集合、manifest 数、证据须与独立重算完全一致；
  - 每个检出，打开证据行，人工确认它是一条真实的依赖或描述符声明，不在注释或排除里；
  - 编造计数必须为 0。
  - 装置先验：
    - 关掉独立实现的遮蔽，hadoop 必须多出 `spring`；
    - 往一个语料副本的 pom 注释里加 `primefaces`，结果不得变化；
    - 把同一行移出注释，必须检出 `jsf`。
- **O3 预注册期望**：
  - acceptor 在看产物之前，对照 Context 的探针表写下期望集合；
  - 结果与期望的每一处差异逐条解释，或者是探针近似的偏差，或者是缺陷。
  - 漏检（项目确实用到、却没检出）单独列出、归因，不算失败。
- **O4 事实不变**：13 个语料各与 `/9` 基线对比：
  - 节点、边（含全部 `mentions`、`references`、`injects` 及证据）、缺口、覆盖、`factsDigest` 完全一致；
  - 图头只有 `frameworks`、`pipelineVersion`、`analyzedAt` 不同，`frameworks` 等于 O2 的 id 集合。
  - 任何其它差异都是缺陷。
- **O5 视图普查**：
  - 对 Seam、Cargo Tracker、Sakai 12.7、Dataverse、TomEE 对比新旧 `scan-result.json`：
    - 只有 D7 列出的扩展名的 `fileCategory` 变化，且变化方向符合 D7；
    - 语言 id 与文件集合不变。
  - 报告每个语料变动的文件数。
- **O6 附录审读**（acceptor）：
  - `javaee.md`、`jsf.md` 对照两份 spec 的「SHALL 写明」逐条找到对应段落；
  - 不含行号、evidence、真实项目名或客户信息；
  - 每条推断规则都有「零个或多个候选时不连」的表述；
  - 「Already in the fact graph」列出的边类型与来源，与 `retrieve.mjs` 的 `DETERMINISTIC_EDGE_TYPES` 及 `catalogs/name-bindings.json` 对得上。
- **O7 真实 MCP**：
  - 对 Cargo Tracker 的 `/10` 产物起 stdio MCP，调用全部工具，结果与 `/9` 产物的同一调用相比，只有新鲜度与版本相关字段不同；
  - `knowledge-graph-store.mjs header` 读出 `frameworks: ["javaee", "jsf"]`，且两个 id 的附录文件都存在。
- **O8 耗时**：
  - Sakai 12.7 与 hadoop 的扫描阶段耗时（Lazy 驱动打印的 `scan=`），与同一会话新测的 `/9` 相比，增幅不超过 10% 或 1 秒取大者；
  - 各取 3 次中位数。
- **O9 全量门**（我跑）：
  - `pnpm -r build && pnpm test`；
  - core 测试与 typecheck；
  - `openspec validate --all --strict`；
  - `node scripts/check-refs.mjs`；
  - core dist 重建后，skill 测试在新 dist 上通过；
  - 提交前 grep 客户信息。

## Risks / Trade-offs

- **[关键字仍是子串]** 例如后端 `package.json` 里只有 `eslint-plugin-react` 时会检出 `react`。
  - 本步不收紧既有关键字。探针里没有出现这种误检。
  - 验收逐条复核证据。若出现，归入下一步按格式解析坐标的提案，不在本步临时加规则。
- **[仓库里的示例 / 文档 manifest 也算]** 例如 Dataverse 文档目录下的示例 `ejb-jar.xml`。
  - 检测的含义是「仓库里被扫描的 manifest 声明了它」，不是「主程序用了它」。
  - 每个检出都报 manifest 数与第一处证据，读者能判断。
  - 不想要的目录用 `.excavatorignore` 排除，排除后自然不参与。
- **[遮蔽过度导致漏检]** 例如 Gradle 行内字符串含 `//` 时会遮掉同一行后面的声明。只会漏不会编，O3 列出漏检。
- **[图头不再沿用旧值]** 如果某个旧的 Full 图头写过 `["React", "Vite"]` 这样的叙述，下次事实构建后会被换成检出的 id。叙述性的工具名（Vite、Docker）从图头消失。今天没有读者依赖它们（D4）。
- **[附录被送给只用了 JAX-RS 的项目]** hadoop、fineract 会收到 `javaee.md`。附录按角色分节，模型只在看到对应注解时套用，且一切推断都是 `inferred`。
- **[类别变化影响遗留 Phase 2 分批]** 视图文件从代码批移到非代码批，只影响遗留路径的分组，不影响事实。

## Migration Plan

- 升版本号后，已有产物在下次 Lazy / `sync_facts` 时重建，图头填上检出结果，不需要迁移脚本。
- `ProjectMeta` 的形状不变。
- 回滚时按步 revert 对应 commit。附录与配置的增删由契约测试保证成对。
