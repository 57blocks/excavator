## ADDED Requirements

### Requirement: 架构分析拿到节点语义与页面引用

Phase F3 交给架构分析的输入 SHALL 包括：
- 每个事实节点的 `{id, type, name, filePath}`，节点有 `owner` 时加上 `owner`（方法所属的类）；
- 节点在 `semantic-cache.json` 里有新鲜条目时，它的 `tags`；文件级节点另带 `summary`；
- 事实图里的 `imports` 边，以及 `references` 边连同每条证据的 EL 链（`chain`）与行。

提示词 SHALL 写明：
- 标签是 Phase F2 读源码时写下的；来自附录「Canonical File Roles」的标签表示附录按注解、描述符条目或文件模式判定的角色；
- `references` 边说明哪些类被页面经 EL 绑定，EL 链给出页面用到的成员；F2 看不到这些边，页面绑定的角色只在边里；
- 分层按注入的框架附录的层表进行；附录按角色定层时，以标签与页面引用为准，不以名字、类名后缀、目录或模块为准。

派发 SHALL 全文注入框架附录，不删节、不改写；除模板与输入外不附加编排者自己的内容（Phase 4 的附加上下文、对模块或分层的结论）。

Phase F2 的派发 SHALL 给出本 skill 的目录，使文件分析从被运行的那份 skill 读附录；SHALL 要求：附录「Canonical File Roles」按源码可见的依据给节点指定角色时，节点的 `tags` 含该行 Tags 列的标签。

没有新鲜语义条目的节点不带 `tags` 与 `summary`，不补写、不猜测。

#### Scenario: 会话 bean 的角色进入分层输入
- **WHEN** F2 已为 `OrderProcessorBean.java` 写下带 `service` 标签的语义条目，然后运行 F3
- **THEN** 架构分析拿到的该文件节点带这组标签与摘要

#### Scenario: 页面绑定进入分层输入
- **WHEN** 事实图里有从 `list.xhtml` 到 `OrderBean` 的 `references` 边
- **THEN** 架构分析拿到的边里有这条 `references` 边

#### Scenario: 没有语义的节点不补写
- **WHEN** 某节点在 `semantic-cache.json` 里没有新鲜条目
- **THEN** 该节点在输入里只有 `{id, type, name, filePath}`（有 `owner` 时加上 `owner`）

#### Scenario: 附录角色标签由 F2 写下
- **WHEN** F2 读到一个带 `@Stateless` 的类，附录把它定为会话 bean，Tags 列为 `service`
- **THEN** F2 派发要求该类节点的 `tags` 含 `service`，与模型自选的标签并列
