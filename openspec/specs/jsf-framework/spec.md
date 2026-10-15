# jsf-framework Specification

## Purpose
确定性检测 JSF 并提供分层提示；`jsf.md` 附录只作分析 guidance；Facelets 与 JSP 视图文件作为已声明的标记语言进入扫描普查。

## Requirements

### Requirement: 从 manifest 与 JSF 描述符检测 jsf

系统 SHALL 提供 id 为 `jsf` 的框架配置。

manifest：`pom.xml`、`build.gradle`、`build.gradle.kts`、`ivy.xml`、`faces-config.xml`、`web.xml`。

关键字至少覆盖：
- `javax.faces`、`jakarta.faces`；
- `jsf-api`、`jsf-impl`；
- `myfaces`、`primefaces`、`richfaces`、`icefaces`；
- 描述符名 `faces-config`。

配置 SHALL 提供：
- `layerHints`，至少覆盖 `webapp→ui`、`beans→ui`、`converter→utility`、`validator→utility`；
- `entryPoints`，含 `WEB-INF/faces-config.xml` 的通配形式。

#### Scenario: 组件库依赖被检出
- **WHEN** `pom.xml` 声明 `org.primefaces:primefaces`
- **THEN** 检出 `jsf`

#### Scenario: 只有 faces-config.xml 的 Ant 项目被检出
- **WHEN** 项目没有 Maven 或 Gradle 构建文件，`WEB-INF/faces-config.xml` 以 `<faces-config` 为根元素
- **THEN** 检出 `jsf`

#### Scenario: 声明 FacesServlet 的 web.xml 被检出
- **WHEN** `web.xml` 写 `<servlet-class>jakarta.faces.webapp.FacesServlet</servlet-class>`
- **THEN** 检出 `jsf`，证据为该行

#### Scenario: 普通 web.xml 不检出
- **WHEN** `web.xml` 只声明一个普通 servlet 与一个 filter，项目没有其他 `jsf` 关键字
- **THEN** 不检出 `jsf`

### Requirement: jsf 附录只作 guidance

`skills/excavator/frameworks/jsf.md` SHALL 只作 prompt 附录，不产行号。据其约定推出的关系一律 `provenance:"inferred"`，不带 evidence。确定性阶段 MUST NOT 把约定当事实。

附录 SHALL 写明：
- 图里已有哪些确定性事实，分析时 MUST NOT 重画：
  - 页面 EL 名字到 bean 类的 `references`：`@ManagedBean`、`@Named`、faces-config `managed-bean`；
  - `template=`、`ui:include`、`ui:decorate` 与导航规则 view id 的 `mentions`；
  - faces-config 里类名的 `mentions`。
- action 方法返回的 outcome 与隐式导航（outcome 即 view id，无前导 `/` 时相对当前视图目录），只在仓库内恰好一个页面文件匹配时推断页面关系。
  - 导航规则的 `from-outcome` 先于隐式导航。`from-view-id` 为前缀模式（如 `/admin/*`）的规则同样算数；没有 `from-outcome` 的导航条目适用于所有 outcome；带 `from-action` 的条目只适用于该 action 表达式产生的 outcome，字面量 `action="…"` 不匹配任何 `from-action`，看不出 outcome 由哪个 action 产生时该规则无法判定；`faces-config.xml` 之外声明的导航（如 Seam 的 `pages.xml`）也是规则。
  - 存在写着该 outcome、却无法判定是否适用的规则时，MUST NOT 退回隐式导航。
  - 隐式导航从 JSF 2.0 起才有：只在看得出当前视图所在的 web 模块是 JSF 2.0 及以上时使用（该模块的 `faces-config.xml` 的 `version` 为 2.0 及以上，或其构建文件声明 JSF 2.x 及以上的 API 依赖）；JSF 1.x 或看不出版本时不用。按 web 模块判断，不按整个仓库。
- 复合组件标签按其命名空间里的库名，对应到 `resources/<library>/<tag>.xhtml`。
- 组件库标签不透明：`h:`、`f:`、`ui:`、`p:`、`rich:`、`a4j:`、`ice:`、`t:`、`o:` 等。MUST NOT 为它们连到库内部的边，只有其属性里的 EL 有意义，而 EL 已是确定性事实。
- converter / validator 按 id 引用时，只在恰好一个声明使用该 id 时推断。
- 组件角色与分层：页面、模板、复合组件、backing bean、converter、validator、描述符。被页面 EL 绑定的 session bean 不是 backing bean，归服务层；`*Bean.java`、`*Controller.java` 这类与其他框架共用的文件名后缀不单独决定角色。

#### Scenario: 约定不产可引用锚点
- **WHEN** 某关系仅由 `jsf.md` 的约定推出
- **THEN** 该关系为 `inferred`、无 evidence，不进入确定性事实

#### Scenario: outcome 对不上唯一页面时不推断
- **WHEN** action 方法返回 `"detail"`，当前视图目录与根目录下各有一个 `detail.xhtml`，且没有匹配的导航规则
- **THEN** 附录指示不推断页面关系

#### Scenario: JSF 1.x 不用隐式导航
- **WHEN** 项目唯一的 `faces-config.xml` 声明 `version="1.2"`，action 方法返回 `"detail"`，仓库里恰有一个匹配的 `detail.xhtml`，且没有匹配的导航规则
- **THEN** 附录指示不推断页面关系

#### Scenario: 组件库标签不连边
- **WHEN** 页面使用 `<p:dataTable value="#{orders.list}">`
- **THEN** 附录指示不为 `p:dataTable` 连边；EL `orders` 由既有的 `references` 事实承载

### Requirement: Facelets 与 JSP 视图按 markup 普查

扫描 SHALL 把以下扩展名声明为已知语言：

| 扩展名 | 语言 id | 类别 |
|---|---|---|
| `.xhtml` | `xhtml` | `markup` |
| `.jsp` | `jsp` | `markup` |
| `.jspx` | `jspx` | `markup` |
| `.jspf` | `jspf` | `markup` |
| `.tag` | `tag` | `markup` |
| `.tagx` | `tagx` | `markup` |
| `.tld` | `tld` | `config` |

- 语言 id SHALL 与此前按扩展名兜底得到的值相同，因此名字提及与 EL 引用按语言选择的语法模式不变：HTML 式的 `jsp`、`jspf`、`tag`，XML 式的 `jspx`、`tagx`、`xhtml`。
- 核心语言注册表 SHALL 声明 `xhtml` 语言。
- 视图文件仍然没有结构抽取器，抽取结果为 `no-extractor`，与此前相同。

#### Scenario: Facelets 页面归 markup
- **WHEN** 扫描到 `src/main/webapp/orders/list.xhtml`
- **THEN** 其语言为 `xhtml`、类别为 `markup`

#### Scenario: JSP 片段语言 id 不变
- **WHEN** 扫描到 `WEB-INF/jspf/header.jspf`
- **THEN** 其语言为 `jspf`、类别为 `markup`

#### Scenario: 视图的提及与引用不变
- **WHEN** 对既有的 JSF / JSP 名字提及夹具与 EL 引用夹具重新构建
- **THEN** `mentions` 与 `references` 边和此前逐条相同

### Requirement: EL 到方法由附录推断

`frameworks/jsf.md` SHALL 给出从页面到 bean 方法的推断规则。规则只用已有的事实，不新增确定性阶段：
- 从页面到 bean 类的 `references` 边，证据里记下了 EL 链；
- 取根名之后的第一个成员，如 `orders.detail` 的 `detail`、`orders.list` 的 `list`；
- 动作方法与属性用同一条规则：成员 `m` 对应名为 `m`、`getM` 或 `isM` 的方法。证据不记 EL 写在哪个属性里，所以不区分方法表达式与值表达式。

候选集是 bean 类所在文件里、`owner` 为该类、名字是上面三者之一的方法节点。只用节点名与 `owner` 比对，不读源码。恰好一个时，从页面画一条 `inferred` 的 `depends_on` 边到它，不带 `evidence`。以下情形不连：
- 零个：成员在仓库外的父类里，或由 Lombok 等生成；
- 多个：方法重载；
- 根名之后的成员不止一层（`#{orders.selected.name}`）：第二层以后的类型由运行时决定，只解析第一层。

#### Scenario: 动作方法唯一
- **WHEN** `list.xhtml` 写 `action="#{orders.detail}"`，`references` 边连到 `OrderBean`，`OrderBean` 里恰好一个名叫 `detail` 的方法
- **THEN** 附录指示从 `list.xhtml` 画一条 `inferred` 的 `depends_on` 边到 `OrderBean.detail`

#### Scenario: 重载不连
- **WHEN** bean 类里有两个名叫 `detail` 的方法
- **THEN** 附录指示不连
