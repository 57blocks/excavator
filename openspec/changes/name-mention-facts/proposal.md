## Why

遗留 Java EE / JSF 单体的装配大量写在非 Java 文件里：`web.xml` 的 servlet / filter / listener 类、`ejb-jar.xml` 的 bean 与接口、Spring XML 的 `<bean class>`、厂商描述符、JSP 的 `page import`，以及页面之间的 `ui:include`、`template=`、`jsp:include`、导航规则里的视图路径。今天这些文件都在 source-manifest 里、有文件节点、能被检索，但事实层没有任何一条边从它们指向被装配的类或被包含的页面：结构抽取器只覆盖代码语言，XML 等只记 `no-extractor`。结果是装配关系在图上不可见，只被 XML 装配的类看起来没人引用，页面的组合结构也无从遍历。

这是 JSF / Java EE 支持的第一步，也是最通用的一步：不依赖框架、版本或厂商，只记录「这个文件在这一行写了仓库里某个类的全限定名 / 某个文件的路径」。这个事实永远为真，因此可以在不知道目标技术栈的前提下做，且不编造。

## What Changes

- 新增单文件词法阶段：扫描 manifest 里除代码语言以外的全部文件（XML、JSP、Facelets、properties、YAML 等，含未声明扩展名），抽出两类候选：类全限定名形态的 token、带扩展名的路径形态 token，带行号与所在元素 / 属性上下文；标记语言与 properties 的注释不产生候选。
- 新增跨文件解析：类名 token 对 Java 类型全限定名字典（含嵌套类型、`$` 二进制名、成员与 `.class` 后缀）做最长前缀匹配；路径 token 依次按 web 根（含 `WEB-INF/` 的最近祖先目录）、所在目录解析，只有 classpath 引用按路径后缀解析。唯一命中生成新的事实边 `mentions`（文件 → 类 / 文件 → 文件）；多重命中、按规则锚定不到、命中仓库里存在但不是节点的声明或文件，分别记入可见缺口，不猜。
- `mentions` 进入可遍历的确定性边集合。
- `PIPELINE_VERSION` 升到 `lazy-fact-graph/6`；冻结摘要整块重冻。
- 不在本变更内：EL 表达式与 bean 名引用、Java 字符串字面量、包名提及（component-scan）、JSF 资源库路径、注解与 XML 元素的角色分类。它们是后续步骤，词法阶段记录的上下文为其预留。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增「名称提及边」要求（`mentions` 边的生成条件、证据、缺口与覆盖，以及可遍历）。只用 ADDED，不改「支持的事实节点与事实边」的原文（该要求的「至少覆盖」允许新增边类型，也避免与未归档的 dead-code-detection 对同一要求的 MODIFIED 冲突）。

## Impact

- 代码：新增 `skills/excavator/text-mentions.mjs`（单文件词法）；`skills/excavator/lazy-analyze.mjs`（新阶段、版本号）；`skills/excavator/build-fact-graph.mjs`（解析、边、缺口、覆盖）；`skills/excavator/retrieve.mjs`（可遍历边类型）。
- 产物：knowledge graph 新增 `mentions` 边与三类缺口；旧产物因版本号变化在下次同步时整体重投影。
- 不影响：Core 抽取器、代码语言的既有节点与边、MCP 工具的参数与形状。
- 语料：除默认的 wcp / cebreo 外，验收使用若干公开 Java EE / JSF 项目的固定提交（见 design）；真实项目的源码、路径与输出不提交。
