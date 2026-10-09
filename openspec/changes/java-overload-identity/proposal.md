## Why

`node-identity` 规定「签名不同的重载 SHALL 得到不同的 ID」，但 Java 实现做不到：Java 提取器只给出参数**名**，结构汇总层又丢掉了返回类型，于是参数名相同、类型不同的重载派生出同一个 ID。系统按规定把它们报成 `identity-collision` 缺口、只保留第一个声明，其余的从图谱中消失。实测 Apache Fineract（f9c2fcdc）有 7,210 个身份冲突，主代码约 140 个；PRD 核对中，被合并的重载正是错归属的高风险点。

同时 Java 方法没有所属类型（`owner`），一个文件里两个顶层类型的同名同签名方法也会被合并，与「不同 owner 下的同名方法 SHALL 得到不同 ID」相悖。

## What Changes

- **Java 提取器**：每个方法和构造器额外输出参数**类型**列表（`paramTypes`），以及所属类型（`owner`，即所在的类、枚举或记录名）。数组维度和可变参数（`T...`）计入类型，注解与修饰符不计入。
- **结构汇总层**（`extract-structure-result.mjs`）：把 `paramTypes` 原样传给下游，并校验它是字符串数组。
- **`deriveNodeId`**：当声明带有 `paramTypes` 时，签名段由参数类型组成；没有 `paramTypes` 时行为不变。`build-fact-graph` 和 `build-source-index` 两处都把 `paramTypes` 交给它，保证两侧派生同一个 ID。
- 新的 Java 函数 ID 形如 `function:<path>:<Type>#<method>(<T1>,<T2>)`。

## Capabilities

### Modified Capabilities

- `node-identity`：「可区分维度不坍缩」补充 Java 场景——参数名相同、类型不同的重载，以及不同顶层类型下的同名方法，得到不同 ID。

## Impact

- **所有 Java 节点 ID 一次性改变**，Java 项目已有的语义缓存条目会因 ID 不再匹配而失效，按缓存缺失重新生成；不会错配到其它节点。Java 项目的事实摘要（`factsDigest`）随之改变。
- **其它语言不受影响**：只有 Java 提取器输出 `paramTypes`，其它语言的 ID 与摘要逐字节不变。
- 范围外：Java 内部类、匿名类与 lambda 目前不被提取为函数，本变更不改变这一点。
