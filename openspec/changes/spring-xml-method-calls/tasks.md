## 1. 目录

- [x] 1.1 `name-bindings.json` 新增 `xmlMethodCalls` 与 Spring 条目 `spring-xml-method-call`（design D2 的全部调用点），目录版本加一
- [x] 1.2 `name-binding-catalog.mjs` 校验新段：必填字段、未知字段、id 唯一、消费者绑定器存在、`named` 的属性与祖先元素、`when` / `unless` 条件
- [x] 1.3 测试：校验拒绝的每种错误各一例

## 2. 读取

- [x] 2.1 `xml-name-bindings.mjs` 读出方法调用点：方法名（`value` / `setter`，`p:` 去 `-ref`）、行、消费者、`named` 属性值、可选；根元素默认属性展开到没有写该属性的 bean
- [x] 2.2 `name-reference-sites.mjs` 在同一遍读取里收集调用点并计数
- [x] 2.3 测试：每种调用点的读取；注释里的不算；默认属性的展开与被 bean 自身属性覆盖

## 3. 解析与边

- [x] 3.1 新模块 `xml-method-call-resolution.mjs`：所属类（`consumer` / `declared` / `named`）→ 方法查找（类与仓库内祖先、参数个数）→ 桶；守恒断言
- [x] 3.2 `build-fact-graph.mjs`：在 XML 注入之后调用，画 `invokes` 边（证据见 spec），记 `coverage.methodCalls` 与三种缺口及其描述
- [x] 3.3 `lazy-analyze.mjs` 升 `PIPELINE_VERSION` 并写变更说明
- [x] 3.4 `retrieve.mjs` 的确定性边类型、`validate-graph.mjs` 的 `invokes` 证据核对、`excavator-chat` SKILL.md 的边类型列表
- [x] 3.5 测试：spec 的每个 Scenario；守恒篡改报错；图校验在证据行不含 `token` 时报出；从方法 1 跳入边遍历到 XML 文件

## 4. 未使用代码

- [x] 4.1 `unused-code.mjs`：`invokes` 的目标作为根；`counts.roots`；头部注释与守恒消息
- [x] 4.2 `excavator-unused-code` SKILL.md 的定义句
- [x] 4.3 测试：容器调用的方法及其调用链不是候选；`counts.roots` 正确

## 5. 验证

- [x] 5.1 装置先验（design Oracle 的三条）
- [x] 5.2 夹具跑 lazy 与 `unused-code candidates`，结果与 Oracle 一致
- [x] 5.3 本地真实语料修复前后对照与分桶抽查（不用 AWS）
- [ ] 5.4 门：build、core test、typecheck、`pnpm test`
