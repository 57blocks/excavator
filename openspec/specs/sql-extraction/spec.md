# sql-extraction Specification

## Purpose
TBD - created by archiving change sql-object-extraction. Update Purpose after archive.

## Requirements

### Requirement: 只在活动语句上抽取

SQL parser SHALL 先把文件切成语句，再在每条语句的开头匹配对象定义。切分 MUST 识别 `--` 行注释、`/* */` 块注释、单引号字符串、`$tag$ ... $tag$` 定界体，以及 SQL*Plus 中单独占一行的 `/` 终止符。注释、字符串和定界体里的同形文本 MUST NOT 产生任何定义、函数、类或 unplaced 记录。所有产出的行号 SHALL 是原文件的行号。

#### Scenario: 注释里的 CREATE 不产事实
- **WHEN** 文件的行注释与块注释里写着 `CREATE TABLE ghost (...)` 和 `CREATE PROCEDURE ghost_proc`
- **THEN** 不产生名为 `ghost` 或 `ghost_proc` 的任何记录，注释前后的活动语句照常抽取且行号不变

#### Scenario: $$ 函数体里的语句不外泄
- **WHEN** 一个 `CREATE FUNCTION ... AS $$ ... $$ LANGUAGE plpgsql;` 的函数体里含有 `CREATE TABLE inner_t (...)`
- **THEN** 只产出这个函数，不产出 `inner_t`

### Requirement: 对象名取限定名的最后一段

对 `CREATE TABLE`、`VIEW`、`INDEX` 以及本规范抽取的存储代码，parser SHALL 接受 `schema.name` 形式以及双引号、反引号包围的各段，并以最后一段（去掉引号）作为名字。MUST NOT 把 schema 名当作对象名。

#### Scenario: 带 schema 的建表
- **WHEN** 文件里有 `CREATE TABLE app.users (id NUMBER, name VARCHAR2(10));`
- **THEN** 产出名为 `users` 的 table 定义，字段为 `id`、`name`；不产出名为 `app` 的定义

#### Scenario: 引号包围的限定名
- **WHEN** 文件里有 `CREATE TABLE "APP"."ORDERS" (...)`
- **THEN** 产出名为 `ORDERS` 的 table 定义

### Requirement: 存储过程、函数和 trigger 抽成函数

parser SHALL 把 `CREATE [OR REPLACE] [EDITIONABLE | NONEDITIONABLE] PROCEDURE`、`FUNCTION`、`TRIGGER` 抽成 `functions` 记录：`name` 为对象名，`lineRange` 从 `CREATE` 所在行到语句结束行，`params` 为括号里各参数的名字（没有括号时为空），`FUNCTION` 的 `returnType` 为 `RETURN` / `RETURNS` 后的类型，`owner` 为空字符串。

语句结束行的判定：有 SQL*Plus `/` 终止符时取它的前一行；`$$` 定界体取定界体之后第一个 `;` 所在行；否则取下一条活动语句开始前的最后一个非空行，或文件最后一个非空行。

#### Scenario: Oracle 过程以 / 结束
- **WHEN** 文件里有 `CREATE OR REPLACE PROCEDURE app.close_order(p_id IN NUMBER) IS BEGIN ... END;` 后接单独一行的 `/`
- **THEN** 产出函数 `close_order`，`params` 为 `["p_id"]`，`lineRange` 结束于 `/` 的前一行

#### Scenario: 函数带返回类型
- **WHEN** 文件里有 `CREATE OR REPLACE FUNCTION order_total(p_id NUMBER) RETURN NUMBER IS ...`
- **THEN** 产出函数 `order_total`，`returnType` 为 `NUMBER`

#### Scenario: trigger
- **WHEN** 文件里有 `CREATE OR REPLACE TRIGGER trg_orders_bi BEFORE INSERT ON orders ...`
- **THEN** 产出函数 `trg_orders_bi`，`params` 为空

### Requirement: package 抽成类，package body 的子程序是它的方法

parser SHALL 为每个文件中出现的每个 package 名产出一条 `classes` 记录，`lineRange` 覆盖该文件里这个 package 的 spec 与 body。package body 里直接声明的 `PROCEDURE` 与 `FUNCTION` SHALL 各产出一条 `functions` 记录，`owner` 为 package 名，并列入该类的 `methods`。spec 里的子程序声明 MUST NOT 另产函数记录。

#### Scenario: spec 与 body 在同一文件
- **WHEN** 一个文件依次有 `CREATE OR REPLACE PACKAGE order_pkg AS PROCEDURE a; PROCEDURE b; END;` 与 `CREATE OR REPLACE PACKAGE BODY order_pkg AS PROCEDURE a IS ... END; PROCEDURE b IS ... END; END;`
- **THEN** 只产出一条名为 `order_pkg` 的类记录，`methods` 为 `["a", "b"]`；产出两条函数 `a`、`b`，`owner` 都是 `order_pkg`，行号落在 body 里

### Requirement: 未抽取的对象可见

对每条以 `CREATE` 开头、而其对象种类不在本 parser 抽取范围内的活动语句（例如 `SEQUENCE`、`SYNONYM`、`TYPE`、`MATERIALIZED VIEW`），parser SHALL 返回一条 `unplaced` 记录，`lineRange` 为该语句的行范围，`reason` 为 `unextracted-sql-object:` 加小写的对象种类。不以 `CREATE` 开头的语句（DML、`GRANT`、`ALTER` 等）不产生记录。

#### Scenario: CREATE SEQUENCE 成为 unplaced
- **WHEN** 文件里只有 `CREATE SEQUENCE seq_orders START WITH 1;`
- **THEN** 不产出定义、函数或类，产出一条 `unplaced`，`reason` 为 `unextracted-sql-object:sequence`

#### Scenario: 经账本成为可见 gap
- **WHEN** 对含上述语句的项目跑 lazy
- **THEN** 知识图谱的 gaps 里有一条 `unplaced-lines`，scope 为 `sql`，计数包含这条语句

### Requirement: 视图的行号覆盖整条语句

parser SHALL 让 view 定义的 `lineRange` 从 `CREATE` 所在行到语句结束行。

#### Scenario: 多行视图
- **WHEN** 一个 `CREATE OR REPLACE VIEW v_orders AS SELECT ...` 跨 4 行并以 `;` 结束
- **THEN** view 定义的 `lineRange` 覆盖这 4 行
