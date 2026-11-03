## 1. 语句切分与命名

- [ ] 1.1 `sql-parser.ts` 加语句扫描器：跳过 `--`、`/* */`、单引号字符串、`$tag$` 定界体；顶层 `;` 和单独一行的 `/` 结束语句；存储代码的语句延续到 `/`、下一条顶层 `CREATE` 或文件结束
- [ ] 1.2 TABLE、VIEW、INDEX 改为在语句开头匹配，名字支持 `schema.name` 与引号，取最后一段；视图行号覆盖整条语句
- [ ] 1.3 测试：注释里的 CREATE 不产事实；`$$` 体内语句不外泄；`app.users` 得 `users`；`"APP"."ORDERS"` 得 `ORDERS`；多行视图的行号

## 2. 存储代码

- [ ] 2.1 PROCEDURE、FUNCTION、TRIGGER（含 `EDITIONABLE` / `NONEDITIONABLE`）抽成 `functions`：名字、行号、参数名、`FUNCTION` 的返回类型，`owner` 为空字符串
- [ ] 2.2 PACKAGE 与 PACKAGE BODY：每个文件每个 package 一条类记录；body 里的子程序抽成 `owner` 为 package 名的函数并列入 `methods`；spec 的签名不另产函数
- [ ] 2.3 测试：spec 的每个 Scenario；同一文件 spec 与 body 只有一条类记录

## 3. 未抽取对象可见

- [ ] 3.1 其余 `CREATE` 语句返回 `unplaced`，`reason` 为 `unextracted-sql-object:<种类>`
- [ ] 3.2 测试：`CREATE SEQUENCE` 得到一条 unplaced；DML、`GRANT`、`ALTER` 不产记录
- [ ] 3.3 更新 `sql-parser.ts` 头部注释，说明抽取范围与不做的部分

## 4. 验证

- [ ] 4.1 装置先验：名字模式退回 `(\w+)`、去掉注释跳过时，对应测试失败
- [ ] 4.2 诊断夹具跑 `lazy-analyze.mjs`，结果与 design 的 Oracle 一致
- [ ] 4.3 本地真实语料修复前后对照与抽查（不用 AWS）
- [ ] 4.4 三件套 + `pnpm --filter @excavator/core test` + `pnpm run typecheck` 通过
