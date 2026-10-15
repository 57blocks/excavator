## ADDED Requirements

### Requirement: 架构分析拿到节点语义与页面引用

Phase F3 交给架构分析的输入 SHALL 包括：
- 每个事实节点的 `{id, type, name, filePath}`，节点有 `owner` 时加上 `owner`（方法所属的类）；
- 节点在 `semantic-cache.json` 里有新鲜条目时，它的 `tags`；文件级节点另带 `summary`；
- 事实图里的 `imports` 边，以及 `references` 边连同每条证据的 EL 链（`chain`）与行。

提示词 SHALL 写明：
- 标签是 Phase F2 读源码时按框架附录写下的角色；
- `references` 边说明哪些类被页面经 EL 绑定，EL 链给出页面用到的成员；
- 分层按注入的框架附录的层表进行。

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
