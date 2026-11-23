## Context

- 事实层（F1）每次 `/excavator` Lazy 运行都整体重算：`structure-all.mjs` 对每个文件调 Core 的 `analyzeFileFull`，`extract-structure-result.mjs` 校验后写结构行，`build-fact-graph.mjs` 投影节点、边、覆盖与缺口。结构行没有按内容缓存，所以 Core 的改动在下一次运行就进入结构行。
- `PIPELINE_VERSION`（`lazy-analyze.mjs`）写进 `source-manifest.json`。`sync-fact-graph.mjs`、`project-service.mjs`、消费方的新鲜度检查拿它判断事实是否过期。
- F2 语义缓存（`semantic-cache.json`）按节点 id 存，按节点所在文件的内容哈希判新鲜。`select-stale-semantics.mjs` 与 MCP 的语义计划对图里的**每个节点**做「复用 / 生成 / 不可用」三选一。一个没有缓存条目的新节点会被判为「生成」。
- 已有的路由事实只有 JAX-RS：Core 记注解，`route-resolution.mjs` 按 `catalogs/routes.json` 解析，生成 `endpoint` 节点与 `routes` 边。`/excavator-unused-code` 的根只取 `routes` 与 `invokes` 边的目标。
- TS/JS 的名字解析已有一个权威：`module-binding-resolver`（经 import 绑定到模块导出，或本文件的顶层声明）与 `resolveBoundCallSite`（含命名空间成员）。Go 的 `pkg.F` 调用今天不解析。
- import map 的 `resolvedSources` 只记 tree-sitter 认出的 ES `import` 说明符；`require()` 字面量只经正则进 `importMap` 边，不进 `resolvedSources`；动态 `import()` 不进任何地方。
- 实测语料 `go-multirepo` 的注册写法：
  - Gin：处理函数里的参数 `engine *gin.Engine`；`v2 := engine.Group("/v2")` 多层嵌套；处理者多为 `e.CatchError(pkg.Func)` 这样包一层；还有 `engine.Any("/health", func(c *gin.Context) {...})`；4 个路由写在接收 `*gin.RouterGroup` 参数的函数里。
  - Express：`const router = express.Router()`；`module.exports = passport => { router.post(...); return router; }`；`app.js` 里 `const x = require('./routes/w')(passport)` 后 `app.use('/worklogs', x)`；处理者多为 `wrapAsync(async (req, res) => {...})`。
  - React Router v7：`export const routes: Array<RouteObject> = [...]` 与 `createBrowserRouter(routes)`；对象里有 `path`、`Component`、`element`、`lazy: withAuthLazy(() => import('src/pages/...'))`、`children: coreFeaturesRoutes`（别的文件导出的数组）、数组里直接放导入的对象或 `...publicRoutes`；被懒加载的 `*Outlet` 组件里再写 `<Routes><Route path="profile" Component={X} /></Routes>`，挂在父路由 `path: '/my/*'` 下。

## Goals / Non-Goals

**Goals：**
- Gin、Express、React Router 的注册由 Core 确定性抽取，跨文件前缀由事实构建确定性拼接，处理者解析到已有节点。
- 每个注册、每个挂载落一个可见桶，桶与记录守恒。
- `/excavator-domain` 与 `/excavator-unused-code` 读同一份入口点事实。
- 已有项目升级后，`/excavator` 不带 `--full` 就带上新字段；F2 语义缓存一条不失效。

**Non-Goals：**
- 其它框架（Spring MVC、NestJS、FastAPI、Flask、Koa、Next.js 文件路由……）。它们由「脚本未识别」加模型补充覆盖；要加规则另起变更。
- 跨函数传递的 Gin 分组（`Register(v2)`）、Express 的 `router.route('/x').get(h)` 链、类里的 `this.router.get(...)`、常量求值、循环与配置驱动的注册：都落可见桶或「脚本未识别」，不猜。
- 改 JAX-RS 目录、`endpoint` 节点、语义缓存格式或 F2 选择规则。
- 新 skill；入口点进 source index。

## Decisions

### D1 入口点是一条记录流，不是节点

备选：
- (a) 复用 `endpoint` 节点加 `routes` 边（JAX-RS 的做法）：入口点可遍历、可检索。但每个新节点都会进 F2 语义计划，因没有缓存条目被判为「生成」。`go-multirepo` 上约有上千个入口点，等于让 F2 重新生成这些节点；这违反硬约束「语义缓存 10483/10483 命中、0 个节点要重生成」。要避免，就得让语义计划排除规则节点，这会改 JAX-RS 端点与 GraphQL/protobuf 端点的既有契约。
- (b) 在处理函数节点上加字段：改了已有节点的内容。
- (c) 知识图新增记录流 `entryPoints`，每个入口点一条记录，处理者以节点 id 引用已有节点。

选 (c)。代价：入口点本身不是 `recall`/`traverse` 的节点（处理函数仍是）。日后要让入口点成为节点，先另起变更让语义计划排除规则节点。

`knowledge-graph-store.mjs` 的 `STREAMS` 加 `entryPoints -> { record: 'entryPoint', field: 'entryPoint' }`。`factsDigest` 的输入加 `entryPoints`。`validate-graph.mjs` 认这个键。

### D2 规则是 `FrameworkConfig.routes`，数据，不是分支

`packages/core/src/languages/types.ts` 加 zod schema（严格：未知键、缺字段、类型不符都让注册失败）。抽取器不出现任何框架名。

```ts
routes?: {
  // The file is read only when it names one of these modules: an import source
  // (Go import path, TS/JS ES import) or a TS/JS require() string literal. Exact match.
  importSources: string[];
  kind: "http" | "ui";
  // How a path joins the prefix it is registered under (D4).
  join: "append" | "nested";
  // Receivers: where a call's object comes from.
  receivers?: {
    // A local assigned from a call to one of these callees is a root (prefix "").
    rootFactories?: string[];          // gin: gin.Default, gin.New ; express: express
    // A local assigned from a call to one of these callees is a router: its prefix comes from a mount.
    routerFactories?: string[];        // express: express.Router, Router
    // A parameter whose declared type is one of these is a root.
    rootParamTypes?: string[];         // gin: *gin.Engine
    // A parameter whose declared type is one of these is registered under an unknown prefix.
    prefixParamTypes?: string[];       // gin: *gin.RouterGroup
    // x := recv.<method>(path, ...) makes x a receiver under recv's prefix + path.
    groupMethods?: string[];           // gin: Group
  };
  // recv.<verb>(path, ..., handler): verb text -> method. The handler is the last argument.
  calls?: { verbs: Record<string, string>; pathArgument: number };
  // recv.<method>(path?, target): target is mounted under recv's prefix + path.
  mounts?: { methods: string[] };      // express: use
  // JSX: <Tag pathAttribute=... handlerAttributes...>children</Tag>
  elements?: {
    tags: string[];                    // Route
    pathAttribute: string;             // path
    indexAttribute?: string;           // index
    handlerAttributes: string[];       // element, Component, lazy
    // An element of one of these tags makes its descendants roots (prefix "").
    rootTags?: string[];               // BrowserRouter, HashRouter, MemoryRouter, Router
  };
  // Route objects: { pathKey, handlerKeys..., childrenKey: [...] }.
  objects?: {
    pathKey: string;                   // path
    indexKey?: string;                 // index
    handlerKeys: string[];             // element, Component, lazy
    childrenKey: string;               // children
    // A variable whose type annotation names one of these types holds route objects.
    containerTypes?: string[];         // RouteObject
    // An array passed to a call of one of these callees holds root route objects.
    rootFactories?: string[];          // createBrowserRouter, createHashRouter, createMemoryRouter
  };
}
```

`routes` 也可以不写：其余框架不变。一份规则只在 `languages` 里的语言上运行。

三份规则：

| 框架 | 要点 |
|---|---|
| `gin` | `importSources: ["github.com/gin-gonic/gin"]`，`kind: http`，`join: append`；动词 `GET POST PUT PATCH DELETE HEAD OPTIONS Any`（`Any` → `ANY`），`pathArgument: 0`；`groupMethods: ["Group"]`；`rootFactories: ["gin.Default","gin.New"]`；`rootParamTypes: ["*gin.Engine"]`；`prefixParamTypes: ["*gin.RouterGroup"]` |
| `express` | `importSources: ["express"]`，`kind: http`，`join: append`；动词 `get post put patch delete head options all`（大写，`all` → `ALL`），`pathArgument: 0`；`mounts.methods: ["use"]`；`rootFactories: ["express"]`；`routerFactories: ["express.Router","Router"]` |
| `react` | `importSources: ["react-router","react-router-dom"]`，`kind: ui`，`join: nested`；`elements`：`Route`，`path`，`index`，`element/Component/lazy`，根标签 `BrowserRouter HashRouter MemoryRouter Router`；`objects`：`path`，`index`，`element/Component/lazy`，`children`，`containerTypes: ["RouteObject"]`，`rootFactories: ["createBrowserRouter","createHashRouter","createMemoryRouter"]` |

### D3 Core 的抽取输出

`packages/core/src/plugins/route-facts.ts` 导出一个纯函数：输入语法树根节点、语言、本文件的 `imports`、全部带 `routes` 的框架配置；输出 `RouteFacts | undefined`。`TreeSitterPlugin.analyzeFile` 与 `analyzeFileFull` 都在语言抽取器之后调用它，有结果时写入 `structure.routes`，两条路径结果相同。没有规则命中的文件不写这个字段，所以别的文件的结构行字节不变。

```ts
interface RouteFacts {
  sites: RouteSite[];     // every registration a rule matched, in source order
  mounts: RouteMount[];   // every mount a rule matched, in source order
  exportsValue?: { local: string; factory: boolean; line: number }; // CommonJS `module.exports =`
}
interface RouteSite {
  framework: string;            // the config id
  form: "call" | "element" | "object";
  line: number;                 // first line of the call / element / object
  method: string | null;        // http: the mapped verb; ui: null
  path: RoutePath;              // the site's own path joined with every prefix inside the file (D4)
  anchor: RouteAnchor;          // where the rest of the prefix comes from (D4)
  handler: RouteHandler | null; // null: no handler argument / attribute / key
}
type RoutePath =
  | { literal: string }                       // composed, normalized
  | { unresolved: "own" | "prefix"; text: string }; // the first non-literal part as written
type RouteAnchor =
  | { kind: "root" }
  | { kind: "local"; name: string }           // a router local, a container variable, or the enclosing top-level declaration
  | { kind: "parameter"; name: string; type: string };
type RouteHandler =
  | { kind: "name"; text: string; line: number; wrappedBy?: string }    // identifier, a.b, JSX tag
  | { kind: "inline"; line: number; endLine: number; wrappedBy?: string } // function literal / arrow
  | { kind: "module"; source: string; line: number }                     // import('x') anywhere in the value
  | { kind: "other"; text: string; line: number };                       // anything else, first 80 chars
interface RouteMount {
  framework: string;
  line: number;
  path: RoutePath;              // the receiver's prefix inside the file joined with the mount path ("" when omitted)
  anchor: RouteAnchor;
  target:
    | { kind: "local"; name: string }                     // a router / container of this file
    | { kind: "binding"; name: string }                   // an ES import binding
    | { kind: "require"; source: string; called: boolean } // a local initialised by require('x') or require('x')(...)
    | { kind: "other"; text: string };
}
```

匹配规则（全部按语法节点，不按文本）：
- **调用形态**：`recv.verb(args)`，`recv` 是标识符，`verb` 在 `calls.verbs` 里，且 `recv` 是一个已知接收者（下一条）。路径取第 `pathArgument` 个实参；处理者取最后一个实参（实参只有路径时为 `null`）。
- **已知接收者**：本文件里由 `rootFactories`/`routerFactories` 调用初始化的局部变量、由 `groupMethods` 调用初始化的局部变量、类型属于 `rootParamTypes`/`prefixParamTypes` 的参数。别的接收者不是注册（`axios.get('/x')` 之类不进任何记录）。
- **锚**：根工厂变量与根参数类型 → `root`；路由器工厂变量 → `local`（变量名）；前缀参数类型 → `parameter`；分组变量继承父接收者的锚。
- **挂载形态**：`recv.<mounts.methods>(path?, target)`，`recv` 是已知接收者，最后一个实参是标识符。标识符是本文件路由器 → `local`；是 ES import 绑定 → `binding`；是由 `require('x')` 或 `require('x')(...)` 初始化的局部变量 → `require`；其余 → `other`。最后一个实参不是标识符（`cors()`、函数字面量、`express.static(...)`）的 `use` 不是挂载，计入 `mountsIgnored`（见 D7）。
- **JSX 形态**：标签名等于 `elements.tags` 之一的元素。路径属性是字符串字面量或 `{'...'}` 才算字面量。`index` 属性存在且不是 `{false}` 时路径为空（索引路由）。处理者取第一个出现的 `handlerAttributes` 属性：`element={<X/>}` → `name: X`；`Component={X}` → `name: X`；值里含 `import('x')` → `module`。锚：祖先里有根标签 → `root`；否则 → 外层顶层声明（函数或变量）的名字。
- **对象形态**：对象字面量，满足其一：在 `containerTypes` 类型注解的变量的初值里（数组元素或对象本身）；在 `rootFactories` 调用的数组实参里；是某个路由对象 `childrenKey` 数组的元素。键名与值的读法同 JSX。锚：`rootFactories` 实参里 → `root`；容器变量里 → `local`（变量名）。`childrenKey` 的值是标识符，或数组元素是标识符、`...标识符` 时，记一条挂载：路径为该路由对象自己的路径，目标按挂载形态的标识符规则分类。
- **包一层**：处理者是只有一个实参的调用，实参是名字或函数字面量时，取实参，`wrappedBy` 记被调者文本。只拆一层。
- **CommonJS 导出**：`module.exports = X`（`X` 是标识符）→ `{ local: X, factory: false }`；`module.exports = (…) => { … return X }` 或 `function (…) { … return X }`，函数体顶层唯一一个 `return 标识符` → `{ local: X, factory: true }`。
- 读文件的门：`imports[].source`，加上 TS/JS 的 `require('字面量')` 调用，至少命中一条 `importSources`。

### D4 文件内路径拼接

- `append`（Gin、Express）：`join(prefix, p)` = 去掉 `prefix` 末尾的 `/`，去掉 `p` 开头的 `/`，两者非空时用一个 `/` 相连；结果加前导 `/`；除根路径 `/` 外去掉末尾 `/`。`p` 为空串时就是 `prefix`。
- `nested`（React Router）：子路径以 `/` 开头时就是它自己（绝对）；否则按 `append` 接在父路径后；索引路由取父路径。
- 前缀来自：分组变量（Gin `Group`）、祖先路由元素或对象。
- 任一部分不是字符串字面量时，路径为 `unresolved`：自身路径不是字面量 → `"own"`，某个前缀不是 → `"prefix"`；`text` 是第一个不是字面量的部分的写法（前 80 个字符）。
- 去掉末尾 `/*` 不在这里做；它只在 D5 的「经处理者挂载」时用。

### D5 跨文件解析（`entry-point-resolution.mjs`，事实构建里）

纯函数，输入：带 `routes` 的结构行、import map、模块绑定解析器、函数/类声明索引、每个文件的文件节点 id。

1. **挂载目标定位到「文件 + 本地名」**：
   - `local` → 本文件、该名字；
   - `binding` → 经模块绑定解析器的绑定拿到模块与导出名，再在该模块里把导出名换成本地名（`exports[].local ?? name`；`default` 取默认导出）；
   - `require` → `resolvedSources[file][source]` 给出模块；本地名取该模块的 `exportsValue.local`；`called` 与 `factory` 必须一致，否则目标不可解；
   - 外部模块、找不到、多于一个 → 挂载落 `target-unresolved` 或 `target-external`。
2. **经处理者挂载**（只对 `join: nested`）：路由的处理者解析到一个文件或一个声明，而该文件里有锚为 `local` 且名字等于该声明名（或该文件默认导出的本地名，处理者为 `module` 时）的路由，就把这个路由的路径（去掉末尾 `/*`）当作挂载路径。
3. **拼前缀**：从锚为 `root` 的记录出发，沿挂载向下传播完整前缀：一个锚 `local:N` 的组，其前缀集合 = 所有指向（该文件, N）的挂载的完整路径。有环时环上的组不再传播，计入 `cycle`。
4. **每个路由的桶**（恰好一个）：
   - 自身路径或文件内前缀不是字面量 → `path-unresolved`；
   - 锚为 `root` → `resolved`，一个入口点；
   - 锚为 `local`/`parameter`，前缀集合非空 → `resolved`，每个前缀一个入口点；
   - 否则 → `prefix-unresolved`，一个入口点，`path` 为文件内路径，`prefixResolved: false`。
   - 挂载路径本身不是字面量时，经它的前缀记为未解析：路由若再没有别的可解前缀，落 `prefix-unresolved`。
5. **处理者**（每个入口点一次）：
   - `name`：TS/JS 用 `resolveBoundCallSite` 的规则（标识符、命名空间成员）；JSX 标签同理。Go：`a.B` 中 `a` 是导入说明符时，在 `resolvedPackages[file][source]` 目录里的文件中找无 `owner` 的同名函数；无限定的名字在本文件所在目录的文件里找。唯一 → `node`；多个 → `ambiguous`；外部包 → `external`；其余 → `unresolved`。
   - `module`：`resolvedSources[file][source]` → 该文件的文件节点，`module`；外部 → `external`；不可解 → `unresolved`。
   - `inline` → `inline`（记行范围，无节点）；`other` → `unresolved`；`null` → `none`。
6. 入口点按（文件，行，方法，路径）排序，记录：

```json
{
  "kind": "entry", "framework": "gin", "routeKind": "http", "form": "call",
  "method": "GET", "path": "/v2/support/positions", "bucket": "resolved",
  "file": "svc/internal/handlers/handlers.go", "line": 72,
  "handler": { "fate": "node", "text": "support.Positions", "wrappedBy": "e.CatchError",
               "nodeId": "function:svc/internal/handlers/support/positions.go:Positions",
               "file": "svc/internal/handlers/support/positions.go", "line": 18 },
  "source": "script"
}
```

`path` 在 `path-unresolved` 时为 `null`，另写 `pathText`。

### D6 import map 的两处增补

- `resolvedSources[file]` 加上 TS/JS `require('x')` 与 `import('x')` 字面量解析到的文件（与 ES import 同一个解析函数）。`require` 本来就进 `importMap`，不变；`import()` 只进 `resolvedSources`，不加 `importMap` 边——不改已有的 `imports` 边。模块绑定解析器只按 ES import 绑定查 `resolvedSources`，所以调用与 JSX 的解析结果不变。
- 新字段 `resolvedPackages[file][importPath] = dir`：Go 导入解析到的包目录（`resolveGoImport` 结果的共同目录，结果为空不记）。

### D7 覆盖、缺口与守恒

```json
"entryPoints": {
  "status": "ran",
  "frameworks": {
    "gin": {
      "files": 0, "sites": 0,
      "buckets": { "resolved": 0, "path-unresolved": 0, "prefix-unresolved": 0 },
      "entryPoints": 0,
      "handlers": { "node": 0, "module": 0, "inline": 0, "external": 0, "unresolved": 0, "ambiguous": 0, "none": 0 },
      "mounts": { "total": 0, "resolved": 0, "target-unresolved": 0, "target-external": 0, "cycle": 0, "ignored": 0 }
    }
  }
}
```

- 没有任何结构行带 `routes` 时，`frameworks` 为空对象，`status` 仍是 `ran`。
- 缺口：`entry-point-path-unresolved`（每个 `path-unresolved` 路由）、`entry-point-prefix-unresolved`（每个 `prefix-unresolved` 路由）、`entry-point-handler-unresolved`（每个处理者为 `unresolved` 或 `ambiguous` 的入口点）。scope 是框架 id，样例 `<file>:<line> <method> <path 或 pathText>`。
- `assertEntryPointConservation`：每框架 `sites` = 三桶之和；`entryPoints` = 处理者七类之和 = 记录流里该框架 `kind: "entry"` 的条数；`mounts.total` = 除 `ignored` 外五类之和 = 记录流里该框架 `kind: "mount"` 的条数；三种缺口的计数等于对应桶。不等即抛错，不写产物。
- 记录流整体按（`kind`，文件，行，方法，路径）排序。

### D8 版本

`PIPELINE_VERSION` → `lazy-fact-graph/17`，注释写明：结构行（命中规则的文件）加 `routes`；知识图加 `entryPoints` 流与 `coverage.entryPoints`；三种缺口；import map 加两样。旧版本的项目在下一次同步或 `/excavator` Lazy 运行时整体重投影。

### D9 `/excavator-domain` 读事实

- Phase 1：没有 `knowledge-graph.jsonl` 时，先跑 `lazy-analyze.mjs`（确定性、零模型）。陈旧时照旧只警告。
- `extract-domain-context.py`：
  - 删掉 HTTP 类正则（Express/Koa、装饰器路由、Next.js 处理函数、GraphQL resolver、gRPC service）作为入口点来源；从知识图读 `kind: "entry"` 的记录作为入口点，`source: "script"`，`type` 取记录的 `routeKind`（`"http"` 或 `"ui"`），`file` 取处理者所在文件（处理者为 `node`/`module` 时），否则取注册文件；带注册处的片段。
  - 这五条 HTTP 正则改作「像处理者的代码」检测：命中行不是任何 `entry` 记录或 `mount` 记录的注册行（同文件同行）的，算未识别；有未识别命中的文件写进 `unrecognisedFiles: [{ file, lines: [...], matches: [...] }]`。
  - 非 HTTP 四类正则（CLI、事件、定时、导出处理者）不变，`source: "pattern"`。
  - 知识图读不到（没有、格式错）时，入口点来源记为 `unavailable`，写进产物并在 Phase 2 告诉用户，HTTP 入口点为 0；不回退到正则。
- 记录流的两种记录（D1 的 `entryPoints` 流）：`kind: "entry"`（D5 第 6 步的入口点）与 `kind: "mount"`（`{ kind, framework, file, line, path, pathText?, fate }`，`fate` 为 D7 `mounts` 的五类之一，`ignored` 的不记）。挂载记录不计入入口点数；它让 `app.use('/x', r)` 这样的行在上一条检测里算作已识别。

### D10 模型补充与核对

- `split-domain-areas.mjs`：每个文件的材料带上 `unrecognised`（命中行与写法）；区上下文加 `unrecognisedFiles`；清单里每个模块加 `scriptEntryPoints` 与 `unrecognisedFiles` 计数。
- 分析器（Option C）：对区上下文 `unrecognisedFiles` 里的每个文件，找出它注册或处理的入口点，写进输出 `entryPoints: [{ file, line, method, path, quote }]`；`quote` 是该行源码的一段原文。别的文件不写。
- `merge-domain-areas.mjs`：逐条核对
  - `file` 是该区的未识别文件之一，否则 `rejected: file-not-unrecognised`；
  - `line` 在文件行数内，否则 `line-out-of-range`；
  - `quote` 去掉首尾空白后非空、不长于 200 个字符，且是第 `line` 行的子串，否则 `quote-mismatch`。
  - 通过的记 `source: "model"`，进合并结果的 `entryPoints`，计入所在模块。
- 覆盖报告加 `entryPoints: { script, pattern, model: { accepted, rejected: { <reason>: n } } }`，每个模块行加 `entryPoints: { script, pattern, model }` 与 `unrecognisedFiles`。打印 `entry-points script=… pattern=… model=… model-rejected=…`。
- 静默为零：模块没有流程、没被声明跳过，且（脚本 + 正则 + 通过核对的模型入口点 > 0，或有未识别文件）→ `silent-zero`。

### D11 `/excavator-unused-code` 的根

`unused-code.mjs` 读知识图的 `entryPoints`：`kind: "entry"`、处理者 `fate: "node"` 且该 id 是函数节点的，加入根集合。计数 `roots` 加 `entryPoints`（这类根的去重个数）；`routes` 仍只数 `routes` 边的目标。SKILL.md 的定义同步改。

## Risks / Trade-offs

- **形态窄**：只认规则写出的形态。别的写法（`router.route()` 链、类里的路由、跨函数传分组）进「脚本未识别」交给模型，或落 `prefix-unresolved`。都可见。
- **入口点不是节点**：`recall` 不能用路由字符串直接命中入口点。处理函数节点照旧可检索。
- **记录流进 `factsDigest`**：升级后事实摘要变化，已有的域图按新鲜度规则判为过期。这是预期的：升级后本来就要重跑下游。
- **React 的「经处理者挂载」**依赖处理者能解析到文件或声明；`withAuthLazy(() => import(...))` 这种包装靠「值里任意位置的 `import()`」拿模块。别的懒加载写法落 `unresolved` 处理者，路由仍在，只是前缀可能落 `prefix-unresolved`。

## 验收 oracle（动手前写死）

- O1 Core 夹具（每份规则一组，`packages/core/src/plugins/__tests__/route-facts.test.ts`）：
  - Gin：`r := gin.Default(); r.GET("/a", h)`、`v := r.Group("/v1"); w := v.Group("/w"); w.POST("", pkg.F)`、`r.Any("/x", func(c *gin.Context){})`、`e.CatchError(pkg.F)` 包一层、`func Reg(g *gin.RouterGroup) { g.GET("/p", h) }` → 锚 `parameter`、`r.GET(base+"/x", h)` → `unresolved: own`、`axios`/非接收者的 `.GET` 不出现。
  - Express：`const app = express(); app.get('/a', h)`、`const router = express.Router(); router.post('/', wrapAsync(async (req, res) => {}))`、`module.exports = router`、`module.exports = p => { …; return router }`、`app.use('/users', usersRouter)`（require 初始化的局部，`called` 两种）、`app.use(cors())` → ignored、模板字符串含 `${}` 的路径 → unresolved。
  - React：`<BrowserRouter><Routes><Route path="/a" element={<A/>}><Route path="b" Component={B}/><Route index element={<C/>}/></Route></Routes></BrowserRouter>` → `/a`、`/a/b`、`/a`（索引）锚 `root`；组件函数里不在根标签下的 `<Routes>` → 锚 `local:组件名`；`createBrowserRouter([{ path: '/', children: [{ path: 'x', lazy: () => import('./X') }] }])`；`export const r: Array<RouteObject> = [...]` → 锚 `local:r`；`children: imported` 与 `...imported` → 挂载；没有导入 react-router 的文件里同形对象不出现。
  - 同一文件在 `analyzeFile` 与 `analyzeFileFull` 下 `routes` 相同；不命中规则的文件结构没有 `routes` 键。
- O2 解析夹具（`tests/lazy/entry-point-resolution.test.mjs`，跨文件）：Express `app.js` 挂 `require('./routes/u')(passport)` 与 `require('./routes/v')` 两个工厂/直接导出的路由器 → 完整路径；未挂载的路由器 → `prefix-unresolved`；React 根数组 `children` 指向另一个文件导出的数组、懒加载模块里的 `<Routes>` 经 `/my/*` 挂载 → `/my/profile`；Gin `support.F` 经 `resolvedPackages` 解析到另一目录的函数节点；守恒；三种缺口计数等于桶。
- O3 版本：用 `lazy-fact-graph/16` 写出的项目（源码不变）跑 Lazy，产物带 `entryPoints` 流与 `coverage.entryPoints`，`pipelineVersion` 为 /17。
- O4 F2 不失效（`go-multirepo` 的副本）：跑 Lazy 前后，`select-stale-semantics` 的计划都是复用 10483、生成 0、不可用 0；节点集合与每个节点的内容（去掉 Lazy 本来就重写的字段后）逐条相同。
- O5 计数（同一副本）：入口点按框架、桶、模块（按 domain 的模块划分）给出前（旧 HTTP 正则）后（F1）两组数；`resolved` 入口点抽查 20 条（按框架分层）路径与处理者与源码一致，编造 0。
- O6 domain 合并夹具：模型入口点引文对、错行、不在未识别文件、超长四种情况分桶正确；有未识别文件且没有流程、没被声明跳过的模块是 `silent-zero`。
- O7 unused-code 夹具：Express 风格的入口点处理者（函数节点）及其调用链不是候选，`roots.entryPoints` 计数正确。
