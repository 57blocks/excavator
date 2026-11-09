## Why

在一个以 Oracle 为主库的大型 Java 项目上跑 lazy，图里只有 SQL 文件节点和表节点。用本地夹具复现后确认 SQL parser 有三个问题：

- **编造表名**：`CREATE TABLE app.users (...)` 产出的表节点名叫 `app`，字段却是 users 的。名字正则 `(\w+)` 在点号处停下，把 schema 当成了表名。带 schema 前缀的建表语句在真实项目里很常见，这是错误事实进图，不是遗漏。
- **静默丢失**：`CREATE [OR REPLACE] PROCEDURE / FUNCTION / PACKAGE [BODY] / TRIGGER` 和 PostgreSQL 的 `$$` 函数既不产节点，也不产 gap。唯一的痕迹是整个文件计作 `zero-symbol`；文件里同时有表时，文件算 `parsed`，过程就丢得毫无痕迹。那个项目有大量这样的对象，写在 PL/SQL 里的业务规则对所有下游报告都不可见。这违反「没有第四态」。
- 视图的行号只指向 `CREATE` 那一行。

## What Changes

- SQL parser 按语句切分（识别 `--` 与 `/* */` 注释、字符串、`$$` 定界体、SQL*Plus 单独一行的 `/` 终止符），只在活动语句上匹配，注释和字符串里的同形文本不产事实。
- 对象名支持 `schema.name` 和双引号、反引号：表、视图、索引一律取最后一段作名字。
- 存储过程、函数、trigger 抽成 `functions`；package 抽成 `classes`，package body 里的过程和函数是它的方法（`owner` 为 package 名）。
- 所有 `CREATE` 语句里，本 parser 不抽取的对象种类（如 `SEQUENCE`、`SYNONYM`、`TYPE`）以 `unplaced` 返回，原因写明对象种类，经现有账本成为 `unplaced-lines` gap。
- 视图的行号覆盖整条语句。

## Capabilities

### New Capabilities

- `sql-extraction`：SQL 文件的语句切分、对象命名、存储代码抽取，以及未抽取对象的可见性。

### Modified Capabilities

（无）

## Impact

- `packages/core/src/plugins/parsers/sql-parser.ts` 与其测试 `packages/core/src/__tests__/parsers.test.ts`。
- 新增的函数和 package 节点经现有的 `functions` / `classes` 通道进图，`coverage` 的 `kinds.function` / `kinds.class` 对 SQL 开始计数；不改账本、图模式或节点身份规则。
- 已有图里被错命名的表节点，重跑 lazy 后会换成正确的名字（节点 id 随名字变化）。
- 不做：PL/SQL 过程之间的调用边、过程对表的读写边、视图单独的节点类型。
