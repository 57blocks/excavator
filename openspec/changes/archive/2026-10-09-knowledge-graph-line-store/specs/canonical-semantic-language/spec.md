## MODIFIED Requirements

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
- **THEN** 对应语义产物不可用并报告 `noncanonical-language`，而 `knowledge-graph.jsonl` 保持逐字不变
