## Context

`handbook-sections` 把手册拆成可单独选择的部分，依赖表在 `lib/sections.mjs`。数据部分是第一个按这种方式新加的部分。

现有抽取覆盖不到数据部分要的事实（调研结论）：
- core 的 `SQLParser` 只给 `.sql` 文件里的表、视图、索引定义；
- 没有迁移记录；
- 没有从代码到表的边；
- 手册的脚本本来也不读 core 的事实，自己遍历项目（`lib/project-files.mjs`、`lib/applications.mjs`）。

验收语料 go-multirepo 有五个应用：
- 一个 Node 旧服务，有 308 个 Sequelize 迁移，是 JS 文件；`up` 里有 `createTable`、`dropTable` 等调用，也有 `queryInterface.sequelize.query('...')` 里的原始 SQL；
- 三个 Go 服务，用 GORM 的 `TableName()`，返回值是字面值或常量；
- 一个前端。

语料里没有一个 `.sql` 文件。

## Goals / Non-Goals

**Goals**：
- 表清单、迁移、各应用对表名的引用，全部由脚本确定性产出；
- 每个输入落进一个有名字的桶；
- 技术视图显示。

**Non-Goals**：
- 状态字典：下一个变更；
- 列、外键、读写区分；
- Java/JPA、Prisma、Python 等其它 ORM 形式：页面写明这次认得哪些形式，没认的形式是可见的覆盖缺口；
- 改 core。

## Decisions

### D1 第三个部分

`lib/sections.mjs` 加一行 `{ id: 'data', stages: [], file: 'sections/data.md' }`，排在 `features` 之后。`--sections` 的错误提示改为列出三个值。

`sections/data.md` 只有一个阶段「Phase 4b — Data」：
- 跑 `handbook.mjs data <root> <out>`；
- 退出 0：照抄它打印的一行计数；
- 非 0：停下，报告它打印的行。

模型在这一阶段不写任何内容，不派发子代理。数据部分没有第 5、6 阶段的单元。

`data` 每次选中都重新写 `data.json`：它是确定性的，代价只是一次扫描。`state.json` 不记它。

### D2 迁移的识别与重放

**迁移目录**：任何名字匹配 `/^migrat(e|ion|ions)$/i` 的目录。它的直接子文件按扩展名分桶：
- `.js .cjs .mjs .ts`：脚本迁移；
- `.sql`：SQL 迁移；
- 其它：「迁移目录里的其它文件」桶，只计数。

每个迁移目录内按文件名的字节序排序重放，各目录分别重放；同名表跨目录不合并历史，只在清单里合并来源。`createdBy` 与 `lastChangedBy` 取第一个建出它的目录。

实现时补定的几处：
- 文件名以 `.down.sql` 结尾的进「只有 down」桶，计入迁移数但不重放；
- `.sql` 先去掉 `--` 与 `/* */` 注释再识别语句；
- SQL 关键字后面跟的不是标识符时（例如英文句子里的 update the）不算操作；表名位置是 `${…}` 的算认不出表名的操作。

**拆 `up`**：在脚本迁移里，找行首（允许空白）是以下形式之一的行，`down` 同理：
- `up` 或 `async up`，后面跟 `:` 或 `(`；
- `exports.up =`、`module.exports.up =`；
- `export [async] function up`、`export const up =`。
- `up` 区域从 `up` 行开始，到它之后第一个 `down` 行为止；之后没有 `down` 行，就到文件末尾。
- 找不到 `up` 行、或 `up` 行不止一个的文件进「拆不出 up 与 down 的迁移」桶。这类文件仍计入迁移数，但不重放。
- `.sql` 迁移整个文件就是 `up`。

**操作**：在 `up` 区域里识别两类，表名允许跨行、允许空白。
1. 调用：`.createTable( .dropTable( .renameTable( .addColumn( .removeColumn( .changeColumn( .renameColumn( .addIndex( .removeIndex( .addConstraint( .removeConstraint( .bulkInsert( .bulkUpdate( .bulkDelete(`。
   - 第一个参数必须是字符串字面值（`'x'`、`"x"`，或不含 `${` 的反引号串）；`renameTable` 的前两个参数都必须是。
   - 不是的进「认不出表名的迁移操作」桶，带文件与行。
2. SQL：在 `up` 区域的每个字符串字面值里，以及 `.sql` 迁移的全文里，不分大小写匹配：
   - `CREATE TABLE [IF NOT EXISTS] t`
   - `DROP TABLE [IF EXISTS] t[, t…]`
   - `ALTER TABLE t … RENAME TO u`：改名
   - `ALTER TABLE t`：其它改动
   - `RENAME TABLE t TO u[, …]`
   - `CREATE [UNIQUE] INDEX … ON t`
   - `INSERT INTO t`
   - `UPDATE t SET`
   - `DELETE FROM t`
   - `TRUNCATE [TABLE] t`

   表名可加反引号或双引号，可带库名前缀，取最后一段（与 core 的 `SQLParser` 一致）。

**重放**：
- 建表：表存在，记建表迁移。删掉后再建，重新记。
- 删表：表移出「存在」集合，进「被删掉的表」，记删表迁移。之后又建出的，从「被删掉的表」移回清单。被删掉的表的历史（建表迁移、各次改动、含删表这一条）随条目保留。
- 改名：历史跟着走；旧名不再存在，改名记在新名的改动里。
- 其它操作：记为最后一次改动。
- 操作的表在那一刻不存在（之前没有迁移建出它）时，表照样进清单，同时进「改动过但没有迁移建出的表」清单。不丢弃，也不臆造建表迁移。

**位置是名字所在的行**：操作的 `line` 是表名字面值开头所在的行（`renameTable` 取第一个字面值，SQL 取表名开头；`DROP TABLE a, b` 每个名字各取自己的行），不是方法名或关键字所在的行，跨行调用与跨行语句因此引用到能看见名字的那一行。认不出表名的操作仍取方法名所在的行。

**`as`**：改名后，`changes[]` 与 `sources[]`（迁移类）里行上写的名字与表的当前名不同的，记 `as`（行上的名字；相同时省略）。改名那一条自己引用的是旧名，所以记 `as: <旧名>`。模型声明（Go 的 `TableName()` 行、JS 的 `tableName:` 行）按原设计取声明所在的行，不受此限。

### D3 模型声明

只在迁移文件之外找。
- **Go**：`func (…) TableName() string {` 之后、配对的 `}` 之前第一条 `return <expr>`。
  - `expr` 是字符串字面值：表名。
  - `expr` 形如 `Ident`、`pkg.Ident` 或 `pkg.Ident.String()`：在同一应用的 Go 文件里找 `Ident [Type] = "lit"` 形式的 const 或 var 声明。恰好一处：表名就是 `lit`。零处或多处：进「解析不到字面值的模型表名」桶，带位置与找到的处数。
  - 其它形式也进这个桶。
- **JS/TS**：`tableName:` 之后跟字符串字面值的，是表名；跟其它的进同一个桶。
- **迁移目录以外的 `.sql` 文件**：`CREATE TABLE t`。

声明的表并进清单，带来源 `model` 或 `sql` 与位置。没有任何迁移建出过的（含经改名建出），进「只有声明、没有迁移建出的表」清单。迁移建出后又在 `up` 里删掉、之后仍被声明、也没有别的目录留着它的表，行里带到删表为止的迁移历史（建表迁移、改动、迁移类来源），进 `droppedButDeclared[]`，不进「只有声明」；它仍在 `dropped[]` 里。

### D4 表名查找

**查找范围**：`lib/project-files.mjs` 列出的每个文本文件，迁移目录里的文件除外。按 `lib/applications.mjs` 归到应用；不在任何应用下的归到「不属于任何应用」。

对每个文件、每张表，命中以下任一条都算名字出现，记文件、行与规则：
- **规则 a**：一个字符串字面值的全部内容等于表名，区分大小写；
- **规则 b**：不分大小写的 `FROM|JOIN|INTO|UPDATE|TABLE` 之后，跳过空白、可选的引号或反引号与 `库名.` 前缀，接着正好是表名，且前后都不接 `[A-Za-z0-9_]`。

注释里的字符串也会命中，这是规则的一部分，写进页面的说明。模型声明的那一行与 Go 常量声明行都满足规则 a，自然算作出现。

**结论只有两种**：
- 「名字出现在 N 个应用」，附位置；
- 「名字只出现在迁移里」。

不写「未使用」，因为 ORM 间接访问（例如按模型类型访问、表名由别的串拼出）这两条规则看不见。这一点作为固定说明写在章首。

### D5 data.json 与呈现

**`data.json`**：格式 `excavator-product-handbook-data/1`。包含：
- `recognized`：这次认得的形式清单，固定文字的键；
- `applications`：每个应用的迁移数；
- `tables[]`：每张表有：
  - `name`；
  - `sources[]`：`{kind: migration|model|sql, file, line, as?}`；
  - `createdBy`、`lastChangedBy`：迁移的文件；
  - `changes[]`：`{file, line, op, via, from?, as?}`；
  - `mentions`：`{application: [{file, line, rule}]}`；
- `dropped[]`、`changedNeverCreated[]`、`declaredOnly[]`、`droppedButDeclared[]`、`onlyInMigrations[]`；`counts.droppedButDeclared` 是它的长度；技术手册与页面各有一个同名清单；
- `gaps`：`{unsplitMigrations[], unnamedOperations[], unresolvedModelNames[], otherMigrationFiles[]}`；
- `counts`。

计数全部由脚本从清单算出，渲染只读 `counts`。`load` 时校验形状，不合格的 `data.json` 在技术视图写一行可见的说明，不渲染内容。

**手册**：`handbook-technical.md` 在系统概览之后加「数据」一章：
- 章首的固定说明；
- 计数行：表、各应用迁移数、名字出现在两个以上应用的表、名字只出现在迁移里的表；
- 表清单；
- 上述四个清单与缺口。

位置都用现有的路径渲染方式。

**页面**：
- 页面数据格式升到 `/6`，加可选字段 `data`；
- 技术视图有路由 `#/data` 与侧栏链接；
- 数据页渲染同样的内容，表清单可按名字、应用数排序；
- 产品视图不出现路由与链接。

**没有 `data.json` 时**：技术视图的数据位置写一行「数据部分没有写出」，与其它没写的部分一致。

固定文字全部是 `ui-strings.json` 的新键。

### D6 性能

一次遍历每个文件：
- 先取出所有字符串字面值，放进集合，查规则 a；
- 再用一个关键字正则扫规则 b，查表名集合。

不按表 × 文件做嵌套正则。

## Risks / Trade-offs

- **规则 a 会把恰好等于表名的普通字符串算作出现**（例如名为 `users` 的表与一个 `'users'` 路由键）。名字出现会偏多，「只出现在迁移里」会偏少。验收按难例分层抽查这一类，照实记录。
- **按行拆 `up` 与 `down` 是启发式的**：写法反常的文件进可见的桶，不静默重放错。
- **默认运行**也跑数据部分：只是一次扫描；默认视图只有产品视图时页面不显示，要 `--views technical`。

## Oracles

- **O1 抽取**：新夹具 `tests/fixtures/product-handbook/data-project/`，有两个应用。
  - Node 应用的迁移覆盖：
    - 建、改、改名、删、只在 `down` 里删；
    - 跨行的 `createTable(`；
    - 变量表名；
    - 原始 SQL 的各句式；
    - 改动没建过的表；
    - 没有 `up` 的文件；
    - 迁移目录里的 `README`。
  - 模型：`tableName`。
  - Go 应用：字面值、一处常量、两处同名常量。
  - 一个迁移外的 `.sql` 文件。
  - 代码里规则 a、b 的命中与近似不命中：表名是标识符的一部分、`users_extra`。

  期望值手写在测试里，不从实现生成。守恒测试：迁移文件、操作、模型声明，每个输入恰好在一个桶里。

  变异必须各红至少一条：
  - 去掉 `up`/`down` 拆分；
  - 规则 b 去掉边界；
  - 不处理改名；
  - 常量多处匹配时取第一处。
- **O2 部分**：
  - `sections` 的测试覆盖 `data`：`--sections data` 只打印 `READ=sections/data.md`；
  - 默认值打印四个文件；
  - 合约测试钉住 `sections/data.md` 的摘要；
  - 地图、概览、功能三个文件的摘要不变。
- **O3 呈现**：渲染测试：
  - 技术视图有数据一章与页面路由；
  - 产品视图没有；
  - 缺 `data.json` 与不合格的 `data.json` 各有一行说明；
  - 计数行与清单长度一致。
- **O4 真实运行**（go-multirepo，Sonnet 是测量条件）：以 `--sections data --views technical` 在第 3a 片输出的副本上续跑。
  - 不派发子代理；`state.json` 不变；花费照实记录。
  - 迁移数等于 `ls` 数出的 308。
  - 脚本交叉核对：`data.json` 里每个位置的那一行确实含有表名，100%。
  - 分层抽查，每类 5 张由验收者用 grep 独立核对：
    - 名字出现在两个以上应用的表；
    - 名字只出现在迁移里的表；
    - 被删掉的表；
    - 只有声明的表；
    - 被迁移删掉、仍被声明的表；
    - 解析不到字面值的模型表名。
  - 与参考手册的 233 张表、52、39 对照，说明差异来源。参考是模型写的，不作门槛。
- **O5**：受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑；源码零非 ASCII 字符。
