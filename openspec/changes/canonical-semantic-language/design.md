## Context

见 [proposal.md](./proposal.md)。当前 `packages/core/src/persistence/index.ts` 默认并持久化 `outputLanguage`，`skills/excavator/SKILL.md` 又把该值注入 Full/Domain 提示；Chat 的按需语义没有同一存储语言控制。现有 semantic cache 只以 source hash 判断 freshness，因此同一节点的中文摘要不会因后续英文问题自动失效。

事实图和 SourceSnapshot 仍是权威；本 change 只能迁移模型生成语义，不能翻译或改写源码字段。`semantic-cache-reuse` 将在本 change 之后使用这里定义的规范语言身份。

## Goals / Non-Goals

**Goals:**

- 给 semantic cache、semantic graph 和 domain graph 一个相同的英文语言身份与 freshness 规则。
- 在不触碰事实图的情况下，让旧混语数据可见失效并按需重建。
- 把回答语言推迟到回源核实之后，并保持请求级、无持久化。
- 用能识别英文、中文污染和 source-owned 原文的 oracle 证明约束有效。

**Non-Goals:**

- 不为每种语言保存语义副本。
- 不翻译旧摘要作为迁移结果。
- 不翻译标识符、路径、literal 或逐字证据。
- 不在本 change 实现缓存零写复用或查询范围路由。

## Decisions

### D1. 规范语言由确定性 schema 控制

升级三类语义产物版本，并在产物顶层写入 `contentLanguage: "en"`。该字段由 writer 固定写入，不从模型 patch 或项目配置接收。读取端只有在版本、原有 freshness key 和语言标记都匹配时才接受产物；semantic-cache 的 freshness API 必须同时接收 cache 级语言身份，不能只看 entry hash。

仅在 prompt 中要求英文不足以建立可机读身份；允许模型自行声明语言又会让数据提升自己的可信度，因此都不采用。

### D2. 语言审计按字段所有权运行

为每种语义产物列出 model-owned prose/tags 字段，审计只遍历这些字段；独立的 source-owned node name、path、identifier、literal、excerpt 明确跳过。model-owned prose 内若引用非英文源码内容，审计只可遮罩由当前事实图或 SourceSnapshot 提供并精确匹配的 source-owned span；模型 patch 不能携带或扩展豁免列表。写入提示固定英文，确定性审计至少识别已知非英文脚本污染，并为所有检查字段产生 accepted/rejected 终态。

审计结果不能仅信任 `contentLanguage` 元数据。测试先用英文解释、中文解释和非英文源码标识符三个假样本证明 oracle 能区分所有权边界，再接入写入路径。

### D3. 旧语义按产物粒度拒绝

旧 semantic cache 作为非规范空缓存读取，只为当前请求需要的节点重新生成；第一次规范提交从该空视图创建新 cache，不把旧文件中的其他条目合并回来。semantic graph 和 domain graph 是整体产物，缺少规范标记时整体返回 `noncanonical-language` 并由各自既有流程重建。任何路径都不重跑或修改 `knowledge-graph.json`。

原地翻译会保留可能已过期或缺证据的旧解释，且无法证明语义仍受当前源码支持，因此不采用。

### D4. 移除存储语言控制面

删除 `/excavator` analyzer 的 `--language`、`$LANGUAGE_DIRECTIVE`、locale 注入和 `outputLanguage` 默认值/类型/读取优先级。读取旧 config 时忽略该字段；下一次规范化写回时删除，同时保留其他配置键。`excavator-figma` 的独立 `--language` 若保留，必须定义自己的指令模板，不能复用即将删除的 `/excavator` 变量。

### D5. 回答语言在证据核实后选择

Chat 保留原问题，并为英文语义与代码产生英文检索表达。事实图/源码核实完成后才计算 request language：显式要求优先，其次当前问题、最近对话，最后英文。最终文本是对核实结论的重述，不是对缓存 summary 的逐句翻译。

### D6. 固定 Conduit 双语验收

在 `test-repo/conduit-realworld-example-app` 的固定提交上先用中文询问收藏文章实现，再用英文询问同一范围。oracle 分开记录实际模型字段语言、回答语言、源码标识符原文和事实图 SHA；是否复用及缓存逐字不变由后续 `semantic-cache-reuse` 验收。

## Acceptance Oracle（冻结于生产修改之前）

每个被审计的 model-owned 字段必须且只能进入 `accepted` 或 `rejected`；每个产物都断言 `inspected = accepted + rejected`，并列出字段路径和原因。`contentLanguage=en` 只是必要元数据，不是任何样本单独通过的依据。

### O1. 字段所有权

| 产物 | 审计字段 | 不审计但保持原文的字段 |
|---|---|---|
| semantic cache | `entries.*.summary`、`entries.*.tags[]` | node id、source hash、model、timestamp、verification |
| semantic graph | `layers.*.name`、`layers.*.description`、`relations.*.description` | layer/relation id、type、fact node endpoints、evidence |
| domain graph | `project.description`、node `name`/`summary`/`tags[]`、`domainMeta` 中的 prose、edge `description` | project name、languages/frameworks、node id/type、filePath、lineRange、nodeIds、edge endpoints/type/direction |

### O2. 冻结样本与唯一结果

| 样本 | 元数据 | 内容 | 期望 |
|---|---|---|---|
| canonical English | `contentLanguage=en` | `Validates the request before writing the article.`、`validation` | 所有审计字段 `accepted` |
| Chinese contamination | `contentLanguage=en` | `在写入文章前验证请求。` 或 tag `验证` | 对应字段 `rejected: noncanonical-language`，产物不提交 |
| forged metadata | `contentLanguage=en` | 与上一行相同 | 仍 rejected，证明不信任标记 |
| verified source span | `contentLanguage=en` | `Calls 提交请假 after validation.`，且当前源码权威集合含精确 span `提交请假` | 遮罩该 span 后字段 accepted，输出仍保留原文 |
| unverified exemption | `contentLanguage=en` | 同上，但权威集合不含该 span或豁免只由模型声明 | 字段 rejected，模型不能提升豁免权限 |
| old cache/product | 缺少标记或标记为 `zh` | 即使 prose 看起来是英文 | 整体 `noncanonical-language`，不参与检索 |
| first canonical write | 旧 cache 混有多个未审计条目 | 只为一个当前节点生成规范英文 | 新 cache 只含重新审计并提交的规范条目，不继承其余旧条目 |

### O3. 请求级回答语言

| 当前请求 | 最近可判断语言 | 显式要求 | 期望回答语言 | `.excavator` 语言写入 |
|---|---|---|---|---|
| 中文自然语言问题 | 任意 | 无 | 中文 | 仅英文语义 |
| English question | 中文 | 无 | English | 仅英文语义 |
| 中文问题 | 中文 | Japanese | Japanese | 仅英文语义 |
| 仅代码标识符 | 中文 | 无 | 中文 | 不持久化选择 |
| 仅代码标识符 | 无 | 无 | English | 不持久化选择 |

每个回答样本必须在事实图或当前源码核实之后再断言语言；不得把翻译后的 cache 文本作为证据。所有样本前后分别记录 `knowledge-graph.json` SHA-256，必须逐字不变。

## Risks / Trade-offs

- [Risk] 语言审计误伤非英文标识符 → 只审计 schema 明确列出的 model-owned 字段，并用原文夹具验证豁免。
- [Risk] 拉丁字母的非英语文本可能逃过轻量审计 → 固定生成提示与内容审计同时使用；oracle 不以元数据单独判定成功。
- [Risk] 旧语义一次性失效增加模型成本 → cache 按当前问题需要惰性重建，semantic/domain 只在对应功能被调用时重建。
- [Trade-off] 移除 `--language` 是破坏性行为 → CLI 明确报错并把用户需求迁移到请求级回答语言。

## Migration Plan

1. 先提交已知英/中/source-owned 样本和双语回答 oracle，并验证它能看见旧行为。
2. 升级三类语义 schema、writer 和 freshness，接入字段所有权审计。
3. 移除旧存储语言控制面，接入请求级回答语言。
4. 跑定向测试、三件套和 Conduit 双语真 provider 验收。

回滚时按逻辑 commit 逆序 revert。新增英文 JSON 对旧读侧仍可解析，未知 `contentLanguage` 字段由旧实现忽略；不对旧数据做不可逆原地迁移。
