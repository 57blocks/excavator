## Why

P0 的 Java EE 需求要求分层可靠，JSF 需求要求页面经 EL 连到 bean 的方法（能解析时）。按「AI 能完成的不写进代码，用 skill 与提示词实现」的原则，参照 TypeScript 的做法，这两件事都不需要新的确定性阶段：
- TS 框架的全部支持是一个框架配置（检测、目录到层的提示）加一份附录（角色、注入、路由、分层），由模型照做；
- Java EE 与 JSF 已经有同样的两样东西，附录里写了按注解、描述符条目与页面引用判定角色，也写了每个角色所属的层。

真正的缺口在呈现层，与框架无关：
- Full 的 Phase F3（架构分析）只拿到节点的 `{id, type, name, filePath}` 与 `imports` 边。
- 经典 Phase 4 给的是带 `summary` 与 `tags` 的文件节点。
- Phase F2 读源码时已按附录给节点打上角色标签（如会话 bean 打 `service`），F3 却看不到；页面到 bean 的 `references` 边也看不到。
- 于是 Java EE 里同以 `Bean` 结尾的会话 bean 与 backing bean，在 F3 无从区分。附录要求的「按注解、描述符条目或页面引用判定」执行不了。

EL 到方法：
- `references` 边从页面连到 bean 类，证据里已记下 EL 链（如 `orders.detail`）；
- 模型读 bean 类就能找到这个成员，属于单元局部读数，写成附录里的推断规则即可。

JSF 的导航结果与复合组件已经在 JSF 附录里，作为推断规则，不需要改动。

这个变更取代同一分支上先前提出的「组件角色与所属层」确定性阶段。那个方案过不了 `frameworks/README.md` 的判据（读一个文件就能判定的留在附录），也与已接受规格「组件角色与分层只作附录指引」冲突。

## What Changes

- `SKILL.md` Phase F3：交给架构分析的输入加上：
  - 有新鲜语义缓存的节点带 `tags`，文件级节点另带 `summary`；
  - `references` 边与 `imports` 边一起给出；
  - 提示词写明角色标签来自读源码时按附录判定，页面引用说明哪些类被页面绑定，分层按附录的层表。
- `frameworks/jsf.md` 增加「EL 到方法」的推断规则：
  - 从 `references` 证据的 EL 链取根名之后的第一个成员；
  - 在 bean 类里找同名的动作方法或属性的 getter，恰好一个方法节点时画 `inferred` 的 `depends_on` 边；
  - 零个或多个时不连。
- 不改 `packages/` 与 `skills/excavator/*.mjs`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `full-semantic-isolation`：新增「架构分析拿到节点语义与页面引用」。
- `jsf-framework`：新增「EL 到方法由附录推断」。

## Impact

- 只改提示词与附录：`skills/excavator/SKILL.md`、`skills/excavator/frameworks/jsf.md`，以及检查提示词内容的测试。
- 事实图、事实图版本与 MCP 都不变。
- F3 的输入变长：每个有语义的节点多一组标签，文件节点多一句摘要，另加 `references` 边。
