## Why

Full 分析会按项目 `outputLanguage` 生成持久化语义，而 Lazy Chat 的按需语义容易跟随当前问题语言；同一源码因此可能长期保留中英文混合缓存。需要把“存储语言”和“回答语言”拆开，让缓存只有一个身份，同时保持用户用任意语言提问和阅读答案。

## What Changes

- 所有 `.excavator` 中由模型生成并持久化的语义文本固定使用英文，并由确定性 writer 写入 `contentLanguage: "en"`。
- 源码标识符、路径、字符串、专有名称和逐字证据保持原文；语言审计只检查模型拥有的解释性字段。
- **BREAKING**：移除 `--language` 与 `outputLanguage` 对持久化语义语言的控制；回答语言改为请求级状态，不再写入项目配置。
- 缺少英文语言标记或包含非英文模型解释的旧 semantic cache、semantic graph、domain graph 以 `noncanonical-language` 可见失效，并从当前源码按需重建；事实图不重建，旧摘要不直接翻译。
- Chat 同时保留原问题和英文检索表达，回源核实后按“显式要求 → 当前问题 → 最近对话 → 英文”选择回答语言。
- `excavator-figma` 的独立输出语言能力不属于 `.excavator` 语义存储，但 SHALL 改用自身定义的语言指令，不再引用 `/excavator` 将删除的 `$LANGUAGE_DIRECTIVE`。
- 在固定提交的 Conduit RealWorld 语料上验证：中文问题写英文语义并返回中文，英文覆盖问题仍使用同一英文数据。

## Capabilities

### New Capabilities

- `canonical-semantic-language`: 定义英文持久化语义、旧数据失效、原文豁免和请求级回答语言。

### Modified Capabilities

（无）

## Impact

- 受影响范围：Full/Lazy/Domain 模型提示、semantic cache/graph/domain schema 与 freshness、analyzer 参数、core config、Chat 回答协议、Figma 语言指令解耦及语言审计测试。
- 行为影响：项目不再选择语义存储语言；已有非规范语义会产生一次按需重建成本，但 canonical fact graph 保持不变。
- 验收语料：`test-repo/conduit-realworld-example-app`，固定提交 `5e127d8569b300e0a21dc2c20ea680da4967b1aa`；源码和生成产物不提交。
- 后续关系：`semantic-cache-reuse` 依赖本 change 提供的规范语言身份。
