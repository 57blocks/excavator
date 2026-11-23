## ADDED Requirements

### Requirement: 框架规则路由入口点

Core SHALL 按框架配置 `routes` 字段里的规则，从 tree-sitter 语法树抽取路由注册与挂载，写进结构结果的可选字段 `routes`（`sites`、`mounts`、`exportsValue`）。规则是数据：抽取代码 MUST NOT 含任何框架名或框架分支；规则 schema 严格，未知键、缺字段、类型不符 SHALL 让注册失败。一份规则只在它声明的语言上、只在本文件导入（ES import、Go import 或 TS/JS `require('字面量')`）了它的 `importSources` 之一时运行。没有规则命中的文件 MUST NOT 带 `routes` 键。

本能力随附三份规则：`gin`、`express`、`react`（React Router）。认的形态：
- 调用：已知接收者上的 `recv.VERB(path, …, handler)`。已知接收者是本文件里由规则的根工厂、路由器工厂或分组方法初始化的局部变量，或声明类型属于规则的根类型、前缀类型的参数。别的接收者上的同名调用 MUST NOT 成为记录。
- 分组：`x := recv.Group(path)`，`x` 的前缀是 `recv` 的前缀接上 `path`。
- 挂载：已知接收者上的 `recv.use(path?, target)`，目标是标识符；目标不是标识符的 SHALL 计为忽略。
- JSX：规则标签的元素，路径属性、索引属性、处理者属性；嵌套元素的路径相对父路径。
- 路由对象：类型注解为规则容器类型的变量的初值、规则根工厂调用的数组实参，以及这些对象 `children` 数组里的对象；`children` 或数组元素是标识符或展开时，记一条挂载。
- 处理者是只有一个实参的调用时，取它的实参，记包装者。

文件内的路径 SHALL 按规则的拼接方式（`append` 或 `nested`）拼好；任一部分不是字符串字面量时 SHALL 记为未解析并保留第一个非字面量部分的写法，MUST NOT 求值。

事实构建 SHALL 跨文件解析：挂载目标经 import 绑定、`require()` 或本文件局部变量定位到被挂载的路由器或路由数组，把挂载的完整路径传给锚在它上面的路由；`nested` 规则的路由，其处理者解析到的文件或声明里锚在该声明上的路由，以去掉末尾 `/*` 的路径为前缀。有环时环上的组 SHALL NOT 传播并计数。每个路由 SHALL 恰好落入一个桶：`resolved`（每个可解的完整路径一个入口点）、`path-unresolved`（自身或文件内前缀不是字面量）、`prefix-unresolved`（锚需要挂载而没有可解的挂载；记一个以文件内路径为路径的入口点）。

每个入口点的处理者 SHALL 解析为 `node`（唯一的函数或类节点）、`module`（懒加载模块的文件节点）、`inline`、`external`、`unresolved`、`ambiguous` 或 `none` 之一。TS/JS 名字按本文件绑定解析（与调用同一规则）；Go 的 `pkg.F` 在该导入解析到的包目录里找无 `owner` 的同名函数，无限定名在本文件所在目录找。MUST NOT 按名字在全仓猜测。

import map SHALL 把 TS/JS `require()` 与 `import()` 字符串字面量解析到的文件记进 `resolvedSources`（`import()` 不增加 `importMap` 边），并把 Go 导入解析到的包目录记进 `resolvedPackages`。

#### Scenario: Gin 分组嵌套与包一层的处理者
- **WHEN** `func Reg(engine *gin.Engine) { v2 := engine.Group("/v2"); s := v2.Group("/support"); s.GET("/offices", e.CatchError(support.Offices)) }`，`support` 导入的包目录里有函数 `Offices`
- **THEN** 一个入口点 `GET /v2/support/offices`，桶 `resolved`，处理者 `node` 指向该函数节点，包装者为 `e.CatchError`

#### Scenario: Express 工厂路由器跨文件挂载
- **WHEN** `routes/w.js` 里 `const router = express.Router(); module.exports = p => { router.post('/', h); return router; }`，`app.js` 里 `const w = require('./routes/w')(passport); app.use('/worklogs', w)`，`app` 由 `express()` 初始化
- **THEN** 一个入口点 `POST /worklogs`，桶 `resolved`

#### Scenario: 没有被挂载的路由器
- **WHEN** 一个文件的 `express.Router()` 路由器注册了 `GET /list`，没有任何文件挂载它
- **THEN** 一个入口点，桶 `prefix-unresolved`，路径 `/list`，缺口 `entry-point-prefix-unresolved` 加一

#### Scenario: 路径不是字面量
- **WHEN** `router.get(base + '/x', h)`
- **THEN** 路由落 `path-unresolved`，`pathText` 为 `base + '/x'`，缺口 `entry-point-path-unresolved` 加一，没有编出的路径

#### Scenario: React 懒加载模块里的 Routes
- **WHEN** 根路由数组里 `{ path: '/my/*', lazy: () => import('src/pages/AccountArea') }`，该模块默认导出的组件里有 `<Routes><Route path="profile" Component={Profile} /></Routes>`
- **THEN** 一个入口点 `/my/profile`，处理者 `node` 指向 `Profile`

#### Scenario: 非接收者上的同名调用
- **WHEN** 导入了 express 的文件里有 `axios.get('/users')`
- **THEN** 它不成为任何记录

### Requirement: 入口点记录流与覆盖

知识图 SHALL 有记录流 `entryPoints`，每条记录 `kind` 为 `entry` 或 `mount`，按（`kind`，文件，行，方法，路径）排序。入口点 MUST NOT 成为节点，已有节点的 id 与内容 MUST NOT 因本能力改变。`factsDigest` SHALL 覆盖这条记录流。

`coverage.entryPoints` SHALL 按框架给出：文件数、路由数、三个桶、入口点数、七类处理者、挂载数及其五类去向与忽略数。SHALL 守恒：路由数等于三桶之和；入口点数等于七类处理者之和，也等于记录流里该框架的 `entry` 条数；挂载总数等于五类去向之和，也等于 `mount` 条数；缺口 `entry-point-path-unresolved`、`entry-point-prefix-unresolved`、`entry-point-handler-unresolved` 的计数等于对应的桶与处理者类。不守恒 SHALL 让构建失败。

`PIPELINE_VERSION` SHALL 升为 `lazy-fact-graph/17`。用旧版本构建的项目，源码不变时，下一次 Lazy 运行 SHALL 重新投影并带上记录流与覆盖。

#### Scenario: 升级后不带 --full 也有新字段
- **WHEN** 一个项目的 `source-manifest.json` 记的是 `lazy-fact-graph/16`，源码没变，执行 `/excavator`（Lazy）
- **THEN** 新的知识图有 `entryPoints` 流与 `coverage.entryPoints`，`pipelineVersion` 为 `lazy-fact-graph/17`

#### Scenario: 语义缓存不失效
- **WHEN** 一个有完整语义缓存（每个节点都命中）的项目升级后跑 Lazy
- **THEN** 语义计划仍是全部复用、0 个生成，节点集合与每个节点的事实字段不变
