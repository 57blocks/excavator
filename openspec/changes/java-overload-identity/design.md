## Context

Java 函数 ID 当前由 `path + name + (参数名列表)` 组成：结构汇总层只传 `name / owner / startLine / endLine / params`，Java 提取器不输出 `owner`，返回类型在汇总层被丢弃。重载只要参数名相同就会撞 ID。

## Decisions

### D1 用参数类型而不是参数名区分 Java 重载

Java 的重载按参数类型区分，参数名不参与。因此 Java 的签名段改为参数类型列表。类型取自 `formal_parameter` 的 `type` 字段，追加声明在变量名上的数组维度；可变参数记为 `T...`；注解与 `final` 等修饰符不计入。空白按现有 `normalizeSignature` 归一。

### D2 只对带 `paramTypes` 的声明改变签名

`deriveNodeId` 的优先级：显式 `signature` → `paramTypes` → `params`。只有 Java 提取器输出 `paramTypes`，所以其它语言的 ID 完全不变，不需要为它们重冻摘要。不把返回类型补回汇总层：那会改变所有语言的 ID，而重载区分不需要它。

### D3 Java 方法带所属类型

`owner` 取方法所在的顶层类、枚举或记录名（与其它语言 `owner` 的语义一致），解决同一文件多个顶层类型下同名方法的合并。既然所有 Java ID 本次都会改变，一并加入 `owner`，避免以后再改一次。

### D4 两处派生共用同一输入

`build-fact-graph` 与 `build-source-index` 都把 `paramTypes` 传给同一个 `deriveNodeId`，保证事实图与源码索引的节点 ID 一致（`node-identity`「单一确定性 node-id 函数」）。

## 验收（动手前写死，全部本地）

1. **非 Java 不受影响（硬门）**：wcp（不含 Java）改前改后 Lazy 的 `factsDigest` 逐字节相同；cebreo（含 8 个 Java 文件）改前改后所有非 Java 文件的节点、以及两端都不是 Java 节点的边完全相同。
2. **Java 冲突消除（硬门）**：Fineract 测试副本（f9c2fcdc，已删文档；改前 Java 函数冲突 122 处、涉及 293 个声明）与 hadoop（2014707f8c31；改前 533 处、1,374 个声明）改后 Java 函数的 `identity-collision` 缺口为 0；若不为 0，逐条列出并说明原因。其它语言与 Gherkin 步骤的冲突（Fineract 有 7,088 处 Gherkin 步骤冲突）不在本变更范围内，数量不得增加。
3. **没有丢东西（硬门）**：Fineract 与 hadoop 改后函数节点数 = 改前函数节点数 + 改前 Java 冲突中被合并掉的声明数（Fineract 293 − 122 = 171，hadoop 1,374 − 533 = 841）；`calls` 边数不减少。
4. **一致性（硬门）**：改后 Fineract 的源码索引中每个函数 `nodeId` 都能在事实图中找到。
5. **门禁**：`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`pnpm test`、`node scripts/check-refs.mjs` 通过；需要重冻的摘要用生成器整块重冻。

## Risks / Trade-offs

- Java 项目的语义缓存一次性失效，首次重跑的模型花费上升。
- 参数类型里的泛型逗号与参数分隔符同为逗号，签名字符串仍确定且可区分，但不可逆解析；ID 只作身份，不被解析。
