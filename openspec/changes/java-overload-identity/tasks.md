验收标准见 design.md「验收」，全部在本地验证。

## 1. 计划

- [ ] 1.1 提交 proposal / design / specs / tasks，`openspec validate java-overload-identity --strict` 通过。

## 2. 实现

- [ ] 2.1 Java 提取器输出 `paramTypes` 与 `owner`（含数组维度、可变参数；不含注解与修饰符），补单元测试。
- [ ] 2.2 结构汇总层校验并传递 `paramTypes`。
- [ ] 2.3 `deriveNodeId` 优先用 `paramTypes` 组成签名；`build-fact-graph` 与 `build-source-index` 传入 `paramTypes`；补测试（重载不再冲突、两侧 ID 一致）。

## 3. 门禁

- [ ] 3.1 `pnpm -r build`、`pnpm --filter @excavator/core test`、`pnpm run typecheck`、`pnpm test`、`node scripts/check-refs.mjs` 通过。

## 4. 验收（本地真实语料）

- [ ] 4.1 wcp 改前改后 `factsDigest` 逐字节相同；cebreo 非 Java 节点与非 Java 边改前改后完全相同。
- [ ] 4.2 Fineract、hadoop 改后 Java 函数的 `identity-collision` 为 0（或逐条说明）；其它冲突数不增加。
- [ ] 4.3 函数节点数按被合并声明数增加（Fineract +171，hadoop +841），`calls` 边数不减少；源码索引的函数 `nodeId` 全部能在事实图中找到。
- [ ] 4.4 把 4.1–4.3 的数字写回本文件。
