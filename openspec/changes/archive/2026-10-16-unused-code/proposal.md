## Why

「哪些代码可以删」是改造遗留系统时的常见问题。需求原文要的是：从入口出发做可达性分析，入口包括 `main`、servlet、JAX-RS / controller 端点、JSF 页面、定时任务、消息驱动 bean 与对外 API；给出未使用代码的**候选**，每条带可信度与原因；输出 JSON，并能在 chat / MCP 里查询；绝不自动删改代码。

之前的变更 `dead-code-detection` 按「零误报的 dead 判定」设计了：
- 五桶判定；
- 语言无关引擎加每种语言的适配器；
- 注解规则目录与项目活性声明文件；
- 可能引用图；
- MCP 新工具。

它的切片 A（Java 引用事实补齐）已合入，判定部分尚未编码。按 2026-10-15 重申的原则（AI 能完成的不写进代码，参考 TypeScript 的做法：框架知识只在附录与数据里），判定部分大多是判断题：哪些方法是框架入口、哪些是对外 API、哪些按约定被反射调用。这些判断应该交给模型，用已有的框架附录，按组决定。代码只做模型做不到的两件事：
- 全仓完整的候选集（「没有引用」是关于不存在的断言，需要完整索引）；
- 大批量的名字出现普查。

同时，名字从「dead code」改为「unused code」。

## What Changes

- **定义。** 未使用代码 = 从任何入口出发都走不到的函数节点，分两种原因：
  - 「没有任何引用」：簇的入口；
  - 「只被不可达代码引用」：簇的成员，附经由的入口。

  互相调用而外面没人调用的孤岛也算。只被测试走到的代码单独标为 `test-only`。方法内部的不可达语句（`return` 之后、`if (false)`）不在范围内。
- **确定性候选集（脚本，零模型）。** `skills/excavator/unused-code.mjs candidates` 读事实图、结构结果与源码清单：
  - 以路由处理方法（`routes` 边，P0 产出）为确定入口；
  - 其余函数节点沿 `calls`、`implements`、`overrides` 分簇，给出每个簇入口与成员；
  - 给出每个节点的事实特征：可见性、注解、所属类的注解与仓库外父类型、所属类被视图 / 描述符 / 注入 / 注解类字面量引用的情况；
  - 全仓选中文件里该名字在已解释位置之外的出现次数与位置。

  不含任何框架或语言分支。
- **入口判断（宿主 skill，模型）。** 新 skill `excavator-unused-code`：
  - 模型用 `jq` 按特征给簇入口分组，结合已检测框架的附录与源码抽读判断哪些组是入口（生产入口或测试入口）；
  - 每条决定记录理由与选出它的查询，id 由查询产生，不手抄。

  决定只能把节点移出候选，不能把节点放进候选。
- **报告（脚本，零模型）。** `unused-code.mjs report` 应用决定，产出 `.excavator/unused-code.json`。每个候选带原因、事实信号与可信度：`high` / `medium` / `low`。可信度由固定规则从事实信号算出：
  - `high`：只给 `private` 且无注解、所属类型不触及仓库外、名字在别处没有出现的方法；
  - `low`：有使用迹象，例如名字在别处出现、所属类被 XML 或视图引用、可能实现仓库外接口；
  - 其余为 `medium`；
  - 簇成员的可信度不高于其入口。
- **查询。** `excavator-chat` 从这个产物回答「X 有没有在用」「哪些可以删」，并核对它与当前事实的摘要是否一致。不新增 MCP 工具。
- **清理已有实现。** 删除 Java 调用解析器的「报告模式」（`dead-code-detection` 的 D13）：它只为旧引擎而写，生产代码没有任何调用方。删除后事实图输出逐字节不变。
- **归档 `dead-code-detection`。**
  - 切片 A 已实现的事实图要求同步进主规格（不含报告模式）；
  - 未实现的 `dead-code` 与 `mcp-tool-surface` 增量删除；
  - 档案里写明判定部分由本变更取代。

## Capabilities

### New Capabilities

- `unused-code`：未使用代码的定义（不可达、两种原因、簇、测试专用），确定性候选集与名字出现普查，入口判断由宿主 skill 承担，可信度规则，产物、新鲜度与查询。

### Modified Capabilities

（无。报告模式从未进入主规格；切片 A 的事实图要求随 `dead-code-detection` 归档同步。）

## Impact

- **代码。**
  - 新增 `skills/excavator/unused-code.mjs`。
  - 新增 `skills/excavator-unused-code/SKILL.md`。
  - 修改 `skills/excavator-chat/SKILL.md` 与插件清单。
  - 删除 `skills/excavator/java-call-resolution.mjs` 的报告模式，以及测试 `tests/facts/java-call-report-mode.test.mjs`。
- **产物。** 新增 `.excavator/unused-candidates.json` 与 `.excavator/unused-code.json`。事实图不变。
- **不再做**（相对 `dead-code-detection`）：
  - 五桶判定与「dead」措辞；
  - 语言适配器与语言表；
  - 注解规则目录 `liveness-catalog/`；
  - 项目活性声明文件 `.excavator-liveness.json`；
  - 可能引用图与按语言记账的文本否决；
  - MCP 工具 `dead_code`；
  - 变异与全链路变异装置。
- **全程 build-free**：不编译目标项目、不安装工具链、不下载依赖。
