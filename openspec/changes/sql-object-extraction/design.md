## Context

`SQLParser`（`packages/core/src/plugins/parsers/sql-parser.ts`）在全文上跑三条正则（TABLE、VIEW、INDEX），只返回 `definitions`。名字是 `(\w+)`，所以 `app.users` 匹配成 `app`；正则在全文上跑，所以注释里的 `CREATE TABLE` 也会匹配。它返回的 `functions`、`classes` 恒为空，存储代码没有任何出口。账本只在 `unplaced` 非空时产 `unplaced-lines` gap，parser 从不返回它。

本地夹具（4 个 `.sql`：普通表、带 schema 的表、视图、过程、函数、trigger、package spec 与 body、PostgreSQL `$$` 函数）跑 lazy 的结果：7 个节点（4 个文件 + 3 个表，其中一个名字错成 `app`），0 个 gap。

## Decisions

### D1 先切语句，再匹配语句开头

用一个小的词法扫描器把文件切成语句，记录每条语句的起止偏移和行号。扫描器跳过行注释、块注释、单引号字符串（`''` 转义）和 `$tag$` 定界体；语句在顶层 `;` 或单独一行的 `/` 处结束。对 PL/SQL 存储代码（过程、函数、trigger、package），体内的 `;` 不结束语句：遇到这几种 `CREATE` 时，语句一直延续到单独一行的 `/`、下一条顶层 `CREATE`，或文件结束。

- 为什么不继续在全文上跑正则：注释里的同形文本会成为事实（编造）；存储代码体内的 `;` 没法和语句结束区分。
- 不引入 SQL 语法库：方言太多（Oracle、PostgreSQL、MySQL、T-SQL），而这里只需要语句边界和开头的几个关键字。

### D2 名字取限定名最后一段

名字的模式改为一个或多个以 `.` 相连的段，每段是标识符、`"..."` 或 `` `...` ``；取最后一段并去掉引号。节点身份规则不变（`<type>:<file>:<name>`），所以同一文件里两个 schema 的同名表会发生身份冲突，并经现有的 `identity-collision` gap 可见，这比编造一个名字好。

### D3 存储代码走现有的 functions / classes 通道

- 过程、函数、trigger 进 `functions`，`owner: ""`（自由函数）。不新增节点类型，也不改图模式；trigger 与过程同样是可执行的命名代码，下游（unused-code、chat、full 的摘要）已经会处理函数节点。
- package 进 `classes`，body 里的子程序是它的方法（`owner` 为 package 名）。spec 只给出签名，不另产函数，否则同名函数会出现两次。同一文件里 spec 和 body 合成一条类记录，避免同 id 冲突；跨文件时各自一条，节点 id 含文件路径，不冲突。
- 参数只取名字：PL/SQL 的参数形如 `p_id IN OUT NUMBER`，取第一个词。

### D4 未抽取的 CREATE 走 unplaced

本 parser 只承诺抽取 TABLE、VIEW、INDEX、PROCEDURE、FUNCTION、TRIGGER、PACKAGE [BODY]。其余以 `CREATE` 开头的语句返回 `unplaced`，`reason` 写对象种类，由现有账本变成 `unplaced-lines` gap，不改账本。DML 和 `ALTER`、`GRANT` 不是对象定义，不报。

### D5 不做的

- PL/SQL 过程之间的调用、过程对表的读写：需要解析 PL/SQL 体，属于另一个切片。
- 视图单独的节点类型：会动图模式和下游的类型枚举；本变更只修视图的行号。

## Risks

- 语句结束行的启发式：没有 `/` 的 Oracle 脚本里，存储代码延续到下一条顶层 `CREATE`。中间若有 `GRANT` 之类的顶层语句，会被算进前一个过程的行范围。只影响行范围的结束行，不产生错误的名字。
- 一个文件里重复定义同名对象（迁移脚本里常见）照旧各产一条，身份冲突照旧经 gap 可见。

## Oracle

动手前写死：

- 单元测试（`parsers.test.ts` 的 SQLParser 两组）：spec 的每个 Scenario 一例。另加一例：同一文件里 spec 与 body 只产一条类记录。
- 装置先验：把名字模式退回 `(\w+)` 时，带 schema 的建表测试必须失败；去掉注释跳过时，注释用例必须失败。
- 夹具对照：对诊断时用的 4 文件夹具跑 `lazy-analyze.mjs`。修复前是 7 个节点、0 个 gap。修复后应有表 `orders`、`users`（没有 `app`）、视图 `v_orders`；函数 `close_order`、`order_total`、`trg_orders_bi`、package body 的两个子程序（`owner` 为 package 名）、PostgreSQL 函数；类 `order_pkg`；`CREATE SEQUENCE` 对应一条 `unplaced-lines` gap；`coverage.sql.kinds.function > 0`。
- 真实语料回归（本地，不用 AWS）：对 `excavator-test-repos` 里已有的、含 `.sql` 文件的语料各跑一次 lazy，比较修复前后：表节点名不再有被截在点号处的；新增的函数和类节点逐类抽查 5 个，名字与行号对得上源码；新增的 `unplaced-lines` 抽查 5 条，确实是未抽取的 `CREATE`。
- 门：三件套 + `pnpm --filter @excavator/core test` + `pnpm run typecheck`。
