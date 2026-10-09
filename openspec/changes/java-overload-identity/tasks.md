验收标准见 design.md「验收」，全部在本地验证。

## 1. 计划

- [x] 1.1 提交 proposal / design / specs / tasks，`openspec validate java-overload-identity --strict` 通过。

## 2. 实现

- [x] 2.1 Java 提取器输出 `paramTypes` 与 `owner`（含数组维度、可变参数；不含注解与修饰符），补单元测试。
- [x] 2.2 结构汇总层校验并传递 `paramTypes`。
- [x] 2.3 `deriveNodeId` 优先用 `paramTypes` 组成签名；`build-fact-graph` 与 `build-source-index` 传入 `paramTypes`；补测试（重载不再冲突、两侧 ID 一致）。

## 3. 门禁

- [x] 3.1 `pnpm -r build`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`pnpm test`、`node scripts/check-refs.mjs` 通过。

## 4. 验收（本地真实语料）

- [x] 4.1 wcp 改前改后 `factsDigest` 逐字节相同；cebreo 非 Java 节点与非 Java 边改前改后完全相同。
- [x] 4.2 Fineract、hadoop 改后 Java 函数的 `identity-collision` 为 0（或逐条说明）；其它冲突数不增加。
- [x] 4.3 函数节点数按被合并声明数增加（Fineract +171，hadoop +841）；消失的 `calls` / `exports` 边全部由重载解释并进入歧义缺口（见 design 验收 3 的修订说明）；源码索引的函数 `nodeId` 全部能在事实图中找到。
- [x] 4.4 把 4.1–4.3 的数字写回本文件。

## 验收结果（本地，2026-10-09）

基线由未改动的 main 生成；hadoop 基线重新生成后 `factsDigest` 仍为 `88c3219d31de`，与固定值一致。

| 语料 | factsDigest 改前 → 改后 | Java 身份冲突（处 / 声明） | 函数节点 | 其它 |
|---|---|---|---|---|
| wcp（无 Java） | `308bd8df06b3` → `308bd8df06b3`（逐字节相同） | 0 → 0 | 6,182 → 6,182 | — |
| cebreo（含 8 个 Java 文件） | `2eacc97208d2` → `dc97cba1413d` | 1 → 0 | 6,288 → 6,289 | 非 Java 节点 12,867 个、非 Java 边 21,516 条改前改后完全相同 |
| Fineract 测试副本 | `7a30d276d3d8` → `7979657ae7c5` | 122 / 293 → 0 | 35,837 → 36,008（+171） | Gherkin 步骤冲突 7,088 不变（范围外） |
| hadoop | `88c3219d31de` → `0cef418fc6fa` | 533 / 1,374 → 0 | 119,346 → 120,187（+841） | 剩余 64 处为 C/C++ 冲突（范围外，改前 64 处） |

边与缺口的变化，全部有对应解释：

| | Fineract | hadoop |
|---|---|---|
| 消失的 `calls` 边（按名字对） | 366，全部由重载解释 | 367，全部由重载解释；另新增 20 条 |
| 消失的 `exports` 边 | 50，全部由重载解释 | 157，全部由重载解释 |
| `calls-ambiguous` | +844 | +675 |
| `exports-ambiguous` | +124 | +343 |
| `calls-caller-unresolved` | −49 | −90 |
| `methods-name-only`（方法挂不到类） | −35,976（新增等量「类 → 方法」边） | −116,451 |
| 源码索引中找不到的函数 `nodeId` | 0 / 36,008 | 0 / 120,427 |

门禁：`pnpm --filter @excavator/core test` 1,054 通过；`pnpm run typecheck` 通过；`pnpm test` 1,540 通过、4 跳过；`node scripts/check-refs.mjs` 通过。新增的测试在未改动的代码上失败（装置自检），改后通过。

