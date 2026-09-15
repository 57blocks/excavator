## Purpose

定义 Excavator 持久化模型语义的唯一英文身份，以及跨语言检索、旧数据失效、源码原文豁免和按当前请求选择回答语言的可验证边界。

## ADDED Requirements

### Requirement: 持久化模型语义统一使用英文

写入 `.excavator` 的模型生成语义文本 SHALL 使用英文，包括 semantic cache 的 summary/tags、semantic graph 的架构描述/layers，以及 domain graph 的领域、流程、步骤与说明；这些产物 SHALL 带有由确定性写入方控制的 `contentLanguage: "en"`。源码标识符、文件路径、代码字符串、专有名称与逐字源码证据 MUST 保持原文，且 MUST NOT 为满足英文规则而改写。

#### Scenario: 中文问题生成英文语义
- **WHEN** 用户用中文提出需要按需语义的问题
- **THEN** 新写入的模型 summary/tags 为英文并带有 `contentLanguage=en`，源码标识符与逐字证据保持原文

#### Scenario: 非英文模型语义拒绝持久化
- **WHEN** 待提交的模型解释性文本明显不是英文或无法声明规范英文
- **THEN** 该语义进入可见 rejected/gap 桶且不修改规范语义产物或事实图

#### Scenario: 原文技术标识不算混语
- **WHEN** 英文解释引用非英文源码标识符、字符串字面量或专有名称
- **THEN** 系统只遮罩从当前事实图或 SourceSnapshot 精确匹配到的 source-owned span，再审计剩余模型解释；它保留原文且不接受模型自行声明的豁免

### Requirement: 存储语言不再由项目偏好选择

持久化语义语言 SHALL 固定为 `en`。`--language` 与项目配置 `outputLanguage` MUST NOT 控制 semantic cache、semantic graph、domain graph 或中间模型语义的语言；分析入口 SHALL 不再提供存储语言切换，既有 `outputLanguage` SHALL 被忽略并在配置规范化写回时移除。回答语言属于请求级表现状态，MUST NOT 写回项目配置。

#### Scenario: 旧项目语言偏好不影响新语义
- **WHEN** 既有配置含 `outputLanguage: "zh"` 并运行 Lazy Chat 或 Full
- **THEN** 新持久化语义仍为英文，旧值不作为语言权威且规范化写回后不再保留

#### Scenario: 旧参数不能创建第二种存储语言
- **WHEN** 用户尝试通过旧 `--language` 选项改变持久化语义语言
- **THEN** 系统明确报告该选项不再支持，而不是生成另一种语言的语义副本

#### Scenario: Figma 语言能力不依赖 Excavator 指令
- **WHEN** `/excavator` 删除存储语言控制面
- **THEN** `excavator-figma` 若继续支持独立输出语言选择，使用自身定义的语言指令且不引用 `/excavator` 的变量或配置

### Requirement: 非规范旧语义按需失效而不重建事实

semantic cache、semantic graph 与 domain graph 的 freshness SHALL 同时校验既有 source/fact freshness key 与 `contentLanguage=en`。缺少语言标记、标记不是 `en` 或模型解释未通过英文审计的旧语义 MUST NOT 进入可信检索；它们 SHALL 以 `noncanonical-language` 的可见原因失效，并按各自产物粒度从当前源码重新生成。迁移 MUST NOT 重建或修改 canonical fact graph，也 MUST NOT 通过翻译旧摘要代替重新核实。

#### Scenario: 旧 semantic cache 惰性迁移
- **WHEN** 读取 source hash 仍匹配但没有规范语言标记的旧 semantic cache
- **THEN** 旧条目不被复用，只为当前请求需要的节点从当前源码重新生成英文语义

#### Scenario: 首次规范写入不继承旧条目
- **WHEN** 非规范旧 semantic cache 中同时存在当前请求需要和不需要的条目，且当前请求提交首个规范英文条目
- **THEN** writer 从非规范空视图创建规范 cache，不携带任何未经重新生成与语言审计的旧条目

#### Scenario: 旧架构或领域语义整体失效
- **WHEN** semantic graph 或 domain graph 的其他 freshness key 匹配但 `contentLanguage` 不是 `en`
- **THEN** 对应语义产物不可用并报告 `noncanonical-language`，而 `knowledge-graph.json` 保持逐字不变

### Requirement: 回答语言由当前请求决定

Chat SHALL 保留用户原始问题并形成英文代码检索表达，使非英文问题能够命中英文规范语义和源码。最终答案 SHALL 在事实图或当前源码核实完成后，按“当前请求显式语言要求、当前问题主要自然语言、最近可判断的对话语言、英文”的顺序选择表达语言。答案 SHALL 用目标语言重新组织已核实结论，MUST NOT 把英文缓存摘要的翻译当作证据，也 MUST NOT 因回答语言变化修改任何 `.excavator` 产物。

#### Scenario: 中文问题返回中文答案
- **WHEN** 用户用中文提问且没有指定其他回答语言
- **THEN** Chat 用中文回答，保留代码标识符和逐字证据原文，并只读写英文规范语义

#### Scenario: 英文覆盖问题不改变存储语言
- **WHEN** 用户随后用英文询问覆盖相同源码范围的问题
- **THEN** Chat 用英文回答并继续使用同一英文语义身份，不创建语言副本

#### Scenario: 显式回答语言优先
- **WHEN** 问题主要为中文但用户明确要求用日文回答
- **THEN** Chat 用日文组织核实后的答案，同时持久化语义仍为英文且源码证据保持原文

#### Scenario: 纯标识符回退到对话语言
- **WHEN** 当前问题只有代码标识符而无法判断自然语言
- **THEN** Chat 使用最近可判断的对话语言；若仍无法判断则使用英文，且不持久化该选择
