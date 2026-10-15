## Why

Java EE 的组件由注解或部署描述符声明，角色因此是代码事实：
- `@Stateless` 类是会话 bean；
- `ejb-jar.xml` 的 `<session><ejb-class>` 指向的类也是；
- `@Entity` 类是实体；
- `web.xml` 的 `<filter-class>` 指向过滤器。

Java EE 与 JSF 附录按这些角色给出所属层，如会话 bean 在 `layer:service`、实体在 `layer:data`。

现状：
- Lazy 事实图不带任何层，也不记组件角色。
- Full 的分层（Phase F3）全由模型凭文件名、路径与 import 关系判断：
  - 后缀 `Bean` 会话 bean 与 backing bean 都在用，单凭文件名分不清；
  - EJB 2.x 的会话 bean 只在 `ejb-jar.xml` 里声明，源码上没有注解，模型看不到；
  - 模型给出的分层没有任何核对。
- 框架定义里的 `layerHints`（目录名到层）没有读取者。

P0 的 Java EE 需求要求「边与层都由测试断言」。边已经由前几个变更完成，层还没有。

## What Changes

- 新增组件角色阶段：
  - 按角色目录，从三种来源给顶层类型确定组件角色：
    - 类型上经确认的注解；
    - 部署描述符里指向类的元素；
    - 页面经 EL 绑定到 `@Named`、`@Model` 类的 `references` 边。
  - 每个角色在目录里声明所属层。一个类型有几个角色、分属不同层时，按目录写死的层次顺序取第一个。
  - 角色与层作为确定性事实记在类节点上，每个角色带可复核的证据（文件、行、写法）。
  - 每个来源点恰好落入一个可见桶，有守恒检查与覆盖记录；落不到节点上的进缺口。
- 只认正向证据，不从「没有」推出层：
  - 没被页面绑定的 `@Named` 类不给层；
  - 只带作用域注解的类不给层；
  - 监听器等附录没有给出层的组件不给层。
- MCP 的 `traverse` 与 `recall` 返回节点时，带上它的层与角色。
- 图校验核对角色证据：证据行必须含它的写法。
- Full 的 Phase F3：
  - 架构分析的输入给出每个节点的确定性层；
  - `semantic-graph.mjs write` 审计模型的分层：有确定性层的节点被放进别的层，或它的文件没放进任何层，记为语义缺口；
  - 只审计，不改写模型的分层。
- Java EE 与 JSF 附录写明这些层是事实，不重新分配；补上会话 bean 同时是 JAX-RS 资源时的归属。
- 事实图版本升到 `lazy-fact-graph/13`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `fact-graph`：新增「组件角色与所属层」。
- `javaee-framework`：新增「Java EE 组件的角色与层由事实给出」。
- `jsf-framework`：新增「JSF 组件的角色与层由事实给出」。
- `full-semantic-isolation`：新增「模型分层按确定性层审计」。

## Impact

- 代码：
  - 新增：
    - `skills/excavator/catalogs/component-roles.json`；
    - 目录加载器 `component-role-catalog.mjs`；
    - 解析模块 `component-role-resolution.mjs`。
  - 修改：
    - `xml-name-bindings.mjs`：从已解析的描述符树读出角色声明；
    - `name-reference-sites.mjs`：在同一趟读取里收集角色声明，不新增遍历全部文件的阶段；
    - `build-fact-graph.mjs`：接入新阶段，写节点属性、覆盖与缺口；
    - `lazy-analyze.mjs`：加载目录，升级事实图版本；
    - `validate-graph.mjs`：核对角色证据；
    - `project-service.mjs`：`traverse` 与 `recall` 的节点投影；
    - `semantic-graph.mjs`：分层审计；
    - `SKILL.md`：Phase F3 的输入；
    - `frameworks/javaee.md`、`frameworks/jsf.md`。
- 产物：Java 类节点多出 `layer` 与 `componentRoles`，覆盖多出 `componentRoles`。事实图版本变化，每个项目的下一次同步完整重投影一次。
- 不改 Core（`packages/core`）：注解与描述符读取都已有。
